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
import sys
import time
import urllib.error
import urllib.request

OPENROUTER_KEY = os.environ.get("OPENROUTER_API_KEY", "")
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
NVIDIA_KEY = os.environ.get("NVIDIA_API_KEY", "")

MODEL_OPENROUTER = os.environ.get("AI_MODEL_OPENROUTER") or "google/gemini-2.0-flash-exp:free"
MODEL_GEMINI = os.environ.get("AI_MODEL_GEMINI") or "gemini-2.0-flash"
MODEL_NVIDIA = os.environ.get("AI_MODEL_NVIDIA") or "openai/gpt-oss-20b"

TIMEOUT = 120


def _post(url, payload, headers, timeout=TIMEOUT):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def _chat_text(res):
    """OpenAI-style answer text, or '' when the model sent nothing usable."""
    try:
        msg = res["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        return ""
    return (msg.get("content") or "").strip()


def _openrouter(prompt, max_tokens):
    if not OPENROUTER_KEY:
        raise RuntimeError("no OPENROUTER_API_KEY")
    res = _post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
            "model": MODEL_OPENROUTER,
            "max_tokens": max_tokens,
            "temperature": 0.1,
            "messages": [{"role": "user", "content": prompt}],
        },
        {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + OPENROUTER_KEY,
            "HTTP-Referer": "https://github.com/govinda-rajulu/openskip",
            "X-Title": "openskip-agent",
        },
    )
    return _chat_text(res)


def _gemini(prompt, max_tokens):
    if not GEMINI_KEY:
        raise RuntimeError("no GEMINI_API_KEY")
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        + MODEL_GEMINI
        + ":generateContent?key="
        + GEMINI_KEY
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": max_tokens},
    }
    last = None
    for attempt in range(3):
        try:
            res = _post(url, payload, {"Content-Type": "application/json"}, timeout=90)
            try:
                return res["candidates"][0]["content"]["parts"][0]["text"].strip()
            except (KeyError, IndexError, TypeError):
                return ""
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 429:
                time.sleep(20 * (attempt + 1))
                continue
            raise
    raise RuntimeError("gemini rate limited: " + str(last))


def _nvidia(prompt, max_tokens):
    if not NVIDIA_KEY:
        raise RuntimeError("no NVIDIA_API_KEY")
    res = _post(
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
    return _chat_text(res)


PROVIDERS = [("openrouter", _openrouter), ("gemini", _gemini), ("nvidia", _nvidia)]


def ask(prompt, max_tokens=8192):
    """Try each provider in order. Return the first non-empty answer.

    Any failure (HTTP 4xx/5xx incl. 404 dead model id and 410 Gone, timeout,
    empty answer) falls through to the next provider."""
    errors = []
    for name, fn in PROVIDERS:
        try:
            text = fn(prompt, max_tokens)
            if not text:
                raise RuntimeError("empty answer")
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
    """One tiny call per provider. Returns the number of seats that answered."""
    ok = 0
    for name, fn in PROVIDERS:
        try:
            text = fn("Reply with exactly: OK", 16)
            good = bool(text)
            ok += good
            print(name + ": " + ("OK " if good else "EMPTY ") + repr(text[:20]))
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
