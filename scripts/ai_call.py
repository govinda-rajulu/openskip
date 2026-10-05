#!/usr/bin/env python3
"""Shared AI provider for SkipStream agent workflows.

Provider order: OpenRouter -> Gemini -> NVIDIA. First non-empty answer wins.
GitHub Models was retired on 2026-07-30 (HTTP 410) and is gone from the chain.

Model IDs come from repo variables so a retired free model is a one-field
change in the GitHub UI, not a code edit:
    AI_MODEL_OPENROUTER, AI_MODEL_GEMINI, AI_MODEL_NVIDIA
Keys come from repo secrets: OPENROUTER_API_KEY, GEMINI_API_KEY, NVIDIA_API_KEY.

Usage:
    from ai_call import ask
    text = ask(prompt, max_tokens=8192)

    python3 scripts/ai_call.py --probe   # one tiny call per provider, prints OK/FAIL per seat

Raises RuntimeError only if every configured provider fails or answers empty.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

OPENROUTER_KEY = os.environ.get("OPENROUTER_API_KEY", "")
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
NVIDIA_KEY = os.environ.get("NVIDIA_API_KEY", "")

# Defaults (os-147): the old ids gemini-2.0-flash-exp:free and gemini-2.0-flash are retired.
# OpenRouter: an empty id means "pick a live free model". Gemini: a retired id walks the
# live list (see _gemini). Pin a working id in the repository variable when one answers.
MODEL_OPENROUTER = os.environ.get("AI_MODEL_OPENROUTER") or ""
MODEL_GEMINI = os.environ.get("AI_MODEL_GEMINI") or "gemini-flash-latest"
MODEL_NVIDIA = os.environ.get("AI_MODEL_NVIDIA") or "openai/gpt-oss-20b"

TIMEOUT = 120
RETRY_CODES = (429, 500, 502, 503, 504)
LENGTH_RETRY_CAP = 16384


def _post(url, payload, headers, timeout=TIMEOUT):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def _get(url, timeout=30):
    with urllib.request.urlopen(urllib.request.Request(url, method="GET"), timeout=timeout) as r:
        return json.load(r)


_THINK = re.compile(r"<think(?:ing)?>.*?</think(?:ing)?>", re.S | re.I)


def clean(text):
    """Drop reasoning blocks some free models put inside the answer."""
    t = _THINK.sub("", text or "")
    if re.match(r"\s*<think(?:ing)?>", t, re.I):  # unterminated: the whole answer was thinking
        return ""
    return t.strip()


def _chat_text(res):
    """OpenAI-style answer text, or '' when the model sent nothing usable."""
    try:
        msg = res["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        return ""
    return clean(msg.get("content") or "")


def _chat_cut_off(res):
    """True when the budget ran out (finish_reason length), usually spent on thinking."""
    try:
        return res["choices"][0].get("finish_reason") == "length"
    except (KeyError, IndexError, TypeError, AttributeError):
        return False


def _post_retry(url, payload, headers, timeout=TIMEOUT, waits=(5, 15)):
    """Busy (429) or server error (5xx): wait and retry, as the providers' docs advise."""
    for wait in list(waits) + [None]:
        try:
            return _post(url, payload, headers, timeout)
        except urllib.error.HTTPError as e:
            if wait is None or e.code not in RETRY_CODES:
                raise
            time.sleep(wait)


def _chat(url, payload, headers):
    """One OpenAI-style call. If the answer is empty because thinking used the whole
    budget, ask once more with 4x the budget (max LENGTH_RETRY_CAP)."""
    res = _post_retry(url, payload, headers)
    text = _chat_text(res)
    if not text and _chat_cut_off(res) and payload["max_tokens"] < LENGTH_RETRY_CAP:
        more = dict(payload, max_tokens=min(payload["max_tokens"] * 4, LENGTH_RETRY_CAP))
        print("ai_call: " + payload["model"] + " ran out of tokens while thinking, retrying with " + str(more["max_tokens"]))
        text = _chat_text(_post_retry(url, more, headers))
    return text


OPENROUTER_FAMILIES = ("gemini", "deepseek", "qwen", "llama", "mistral", "gpt-oss", "nemotron")
OPENROUTER_TRIES = 3
_OPENROUTER_PICKED = None

def openrouter_rank(models):
    """Live free models (id ends with ':free'), known families first, then the rest."""
    ids = [str(m.get("id", "")) for m in models if isinstance(m, dict)]
    free = [i for i in ids if i.endswith(":free")]
    out = []
    for fam in OPENROUTER_FAMILIES:
        out += [i for i in free if fam in i.lower() and i not in out]
    return out + [i for i in free if i not in out]

def _openrouter_skippable(e):
    """400/404/410 = unknown or retired id; 5xx = provider broken: try the next live model."""
    return isinstance(e, urllib.error.HTTPError) and (e.code in (400, 404, 410) or e.code >= 500)

def _openrouter(prompt, max_tokens):
    """AI_MODEL_OPENROUTER first (if set). If it is retired or unset, try at most
    OPENROUTER_TRIES live free models from the public model list."""
    global _OPENROUTER_PICKED
    if not OPENROUTER_KEY:
        raise RuntimeError("no OPENROUTER_API_KEY")
    first = _OPENROUTER_PICKED or MODEL_OPENROUTER
    err = None
    if first:
        try:
            return _openrouter_once(first, prompt, max_tokens)
        except urllib.error.HTTPError as e:
            if not _openrouter_skippable(e):
                raise
            err = e
    live = [m for m in openrouter_rank(_get("https://openrouter.ai/api/v1/models").get("data", [])) if m != first]
    tried = [first + " (HTTP " + str(err.code) + ")"] if err else []
    for model in live[:OPENROUTER_TRIES]:
        try:
            text = _openrouter_once(model, prompt, max_tokens)
        except urllib.error.HTTPError as e:
            if not _openrouter_skippable(e):
                raise
            err = e
            tried.append(model + " (HTTP " + str(e.code) + ")")
            continue
        _OPENROUTER_PICKED = model
        print("ai_call: openrouter tried " + (", ".join(tried) or "nothing pinned") + "; answered by " + model
              + " (set repo variable AI_MODEL_OPENROUTER=" + model + " to pin it)")
        return text
    if err:
        raise err
    raise RuntimeError("openrouter: no live free model")

def _openrouter_once(model, prompt, max_tokens):
    return _chat(
        "https://openrouter.ai/api/v1/chat/completions",
        {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": 0.1,
            # low effort = about 20% of max_tokens for thinking, the rest is left for the answer
            "reasoning": {"effort": "low", "exclude": True},
            "messages": [{"role": "user", "content": prompt}],
        },
        {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + OPENROUTER_KEY,
            "HTTP-Referer": "https://github.com/govinda-rajulu/openskip",
            "X-Title": "openskip-agent",
        },
    )


_GEMINI_PICKED = None


def gemini_rank(names):
    """Live generateContent models, best first: stable flash (newest first), then flash-lite, then any stable gemini."""
    def ver(n):
        m = re.match(r"gemini-(\d+(?:\.\d+)?)-", n)
        return float(m.group(1)) if m else 0.0
    stable = [n for n in names if n.startswith("gemini-") and not re.search(r"exp|preview|tts|image|live|audio|embedding|thinking", n)]
    out = []
    for rx in (r"^gemini-\d+(?:\.\d+)?-flash$", r"^gemini-\d+(?:\.\d+)?-flash-lite$", r"^gemini-"):
        for n in sorted((n for n in stable if re.match(rx, n)), key=ver, reverse=True):
            if n not in out:
                out.append(n)
    return out


def gemini_pick(names):
    r = gemini_rank(names)
    return r[0] if r else None


def _gemini_live_models():
    res = _get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=" + GEMINI_KEY)
    names = [m.get("name", "").split("/", 1)[-1] for m in res.get("models", [])
             if "generateContent" in (m.get("supportedGenerationMethods") or [])]
    return gemini_rank(names)


GEMINI_TRIES = 4


def _gemini_skippable(e):
    """404 = model retired, 5xx = model overloaded (503) or broken: try the next live model."""
    return isinstance(e, urllib.error.HTTPError) and (e.code == 404 or e.code >= 500)


def _gemini_once(model, prompt, max_tokens):
    url = ("https://generativelanguage.googleapis.com/v1beta/models/" + model
           + ":generateContent?key=" + GEMINI_KEY)
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": max_tokens},
    }
    last = None
    for attempt in range(3):
        try:
            res = _post(url, payload, {"Content-Type": "application/json"}, timeout=90)
            try:
                cand = res["candidates"][0]
            except (KeyError, IndexError, TypeError):
                return ""
            parts = (cand.get("content") or {}).get("parts") or []
            text = clean("".join(p.get("text", "") for p in parts if not p.get("thought")))
            budget = payload["generationConfig"]["maxOutputTokens"]
            if not text and cand.get("finishReason") == "MAX_TOKENS" and budget < LENGTH_RETRY_CAP:
                # maxOutputTokens includes thinking tokens (Gemini thinking docs)
                payload["generationConfig"]["maxOutputTokens"] = min(budget * 4, LENGTH_RETRY_CAP)
                print("ai_call: " + model + " ran out of tokens while thinking, retrying with " + str(payload["generationConfig"]["maxOutputTokens"]))
                continue
            return text
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 429:
                time.sleep(20 * (attempt + 1))
                continue
            if e.code >= 500 and attempt == 0:
                time.sleep(5)
                continue
            raise
    raise RuntimeError("gemini rate limited: " + str(last))


def _gemini(prompt, max_tokens):
    """AI_MODEL_GEMINI first. If it is retired (404) or overloaded (5xx, after one retry),
    walk the ranked live model list, at most GEMINI_TRIES models in total."""
    global _GEMINI_PICKED
    if not GEMINI_KEY:
        raise RuntimeError("no GEMINI_API_KEY")
    first = _GEMINI_PICKED or MODEL_GEMINI
    try:
        return _gemini_once(first, prompt, max_tokens)
    except urllib.error.HTTPError as e:
        if not _gemini_skippable(e):
            raise
        err = e
    tried = [first + " (HTTP " + str(err.code) + ")"]
    try:
        live = _gemini_live_models()
    except Exception:
        raise err
    for model in [m for m in live if m != first][:GEMINI_TRIES - 1]:
        try:
            text = _gemini_once(model, prompt, max_tokens)
        except urllib.error.HTTPError as e:
            if not _gemini_skippable(e):
                raise
            err = e
            tried.append(model + " (HTTP " + str(e.code) + ")")
            continue
        _GEMINI_PICKED = model
        print("ai_call: gemini tried " + ", ".join(tried) + "; answered by " + model
              + " (set repo variable AI_MODEL_GEMINI=" + model + " to pin it)")
        return text
    print("ai_call: gemini tried " + ", ".join(tried) + "; no live model answered")
    raise err


def _nvidia(prompt, max_tokens):
    if not NVIDIA_KEY:
        raise RuntimeError("no NVIDIA_API_KEY")
    return _chat(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        {
            "model": MODEL_NVIDIA,
            "max_tokens": max_tokens,
            "temperature": 0.1,
            "messages": [{"role": "user", "content": prompt}],
        },
        {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + NVIDIA_KEY,
            "Accept": "application/json",
        },
    )


PROVIDERS = [("openrouter", _openrouter), ("gemini", _gemini), ("nvidia", _nvidia)]


def looks_json(text):
    """True when the answer is one JSON object (what the fix agents and the audit need)."""
    try:
        return isinstance(json.loads(strip_fences(text)), dict)
    except Exception:
        return False


def ask(prompt, max_tokens=8192, accept=None):
    """Try each provider in order. Return the first non-empty answer that `accept` likes.

    Any failure (HTTP 4xx/5xx incl. 404 dead model id and 410 Gone, timeout,
    empty answer, or an answer `accept` rejects, e.g. thinking text instead of
    JSON) falls through to the next provider."""
    errors = []
    for name, fn in PROVIDERS:
        try:
            text = fn(prompt, max_tokens)
            if not text:
                raise RuntimeError("empty answer")
            if accept is not None and not accept(text):
                raise RuntimeError("answer rejected: " + repr(text[:60]))
            print("ai_call: provider=" + name + " chars=" + str(len(text)))
            return text
        except Exception as e:
            errors.append(name + ": " + str(e)[:200])
            continue
    raise RuntimeError("all providers failed -> " + " | ".join(errors))


def strip_fences(text):
    """Remove markdown code fences if the model wrapped its output."""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        t = t.rsplit("```", 1)[0]
    return t.strip()


def probe():
    """One small call per provider. A seat counts only if its answer contains OK.

    512 tokens because reasoning models (gpt-oss, nemotron, gemini 2.5) think
    before they answer; a 16-token budget comes back empty or mid-thought."""
    ok = 0
    for name, fn in PROVIDERS:
        try:
            text = fn("Reply with exactly the two letters OK and nothing else.", 512)
            model = {"openrouter": _OPENROUTER_PICKED or MODEL_OPENROUTER, "gemini": _GEMINI_PICKED or MODEL_GEMINI, "nvidia": MODEL_NVIDIA}.get(name, "?")
            if "OK" in text.upper()[:40]:
                ok += 1
                print(name + ": OK " + model)
            elif text:
                print(name + ": ANSWERED-BUT-NOT-OK " + model + " " + repr(text[:40]))
            else:
                print(name + ": EMPTY " + model)
        except urllib.error.HTTPError as e:
            print(name + ": FAIL HTTP " + str(e.code) + (" (model id dead? check the AI_MODEL_ repo variable)" if e.code in (404, 410) else ""))
        except Exception as e:
            print(name + ": FAIL " + str(e)[:120])
    print("seats answering: " + str(ok) + " of " + str(len(PROVIDERS)))
    return ok


if __name__ == "__main__":
    if sys.argv[1:] == ["--probe"]:
        sys.exit(0 if probe() > 0 else 1)
    print(__doc__)
