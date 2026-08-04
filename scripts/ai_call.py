#!/usr/bin/env python3
"""Shared AI provider for SkipStream agent workflows.

Provider order: GitHub Models -> OpenRouter -> Gemini.
GitHub Models needs no API key; it uses the GITHUB_TOKEN already
present in every Actions run, and requires `models: read` in the
job's permissions block.

Model IDs come from repo variables so a retired free model is a
one-field change in the GitHub UI, not a code edit.

Usage:
    from ai_call import ask
    text = ask(prompt, max_tokens=8192)

Raises RuntimeError only if every configured provider fails.
"""
import json
import os
import time
import urllib.error
import urllib.request

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
OPENROUTER_KEY = os.environ.get("OPENROUTER_API_KEY", "")
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")

MODEL_GITHUB = os.environ.get("AI_MODEL_GITHUB") or "openai/gpt-4o-mini"
MODEL_OPENROUTER = os.environ.get("AI_MODEL_OPENROUTER") or "google/gemini-2.0-flash-exp:free"
MODEL_GEMINI = os.environ.get("AI_MODEL_GEMINI") or "gemini-2.0-flash"

TIMEOUT = 120


def _post(url, payload, headers, timeout=TIMEOUT):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def _github(prompt, max_tokens):
    if not GITHUB_TOKEN:
        raise RuntimeError("no GITHUB_TOKEN")
    res = _post(
        "https://models.github.ai/inference/chat/completions",
        {
            "model": MODEL_GITHUB,
            "max_tokens": max_tokens,
            "temperature": 0.1,
            "messages": [{"role": "user", "content": prompt}],
        },
        {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + GITHUB_TOKEN,
            "Accept": "application/vnd.github+json",
        },
    )
    return res["choices"][0]["message"]["content"].strip()


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
    return res["choices"][0]["message"]["content"].strip()


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
            return res["candidates"][0]["content"]["parts"][0]["text"].strip()
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 429:
                time.sleep(20 * (attempt + 1))
                continue
            raise
    raise RuntimeError("gemini rate limited: " + str(last))


# GitHub Models was retired on 2026-07-30 and now returns HTTP 410.
# _github is kept only so the import surface does not change; it is
# not in the fallback chain.
PROVIDERS = [("openrouter", _openrouter), ("gemini", _gemini)]


def ask(prompt, max_tokens=8192):
    """Try each provider in order. Return the first success."""
    errors = []
    for name, fn in PROVIDERS:
        try:
            text = fn(prompt, max_tokens)
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
