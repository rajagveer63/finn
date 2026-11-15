"""Thin client for the OpenAI-compatible endpoint, with a disk cache and a token meter.

Routing is by reasoning effort on one model:
  effort="low"  -> bulk extraction and classification (no thinking tokens)
  effort=None   -> default reasoning, used only for qualitative judgement
Every response is cached by a hash of (model, effort, prompt), so a filing is
never paid for twice. The cache is committed, so CI runs reuse it.
"""
import os
import json
import time
import hashlib
import pathlib
import threading
import requests

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "cache" / "llm"
CACHE.mkdir(parents=True, exist_ok=True)

_env = ROOT / ".env"
if _env.exists():
    for line in _env.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

BASE = os.environ.get("LLM_BASE_URL", "").rstrip("/")
KEY = os.environ.get("LLM_API_KEY", "")
MODEL = os.environ.get("LLM_MODEL", "hyde/glm-5.3-flash")

USAGE = {"calls": 0, "cache_hits": 0, "prompt_tokens": 0, "completion_tokens": 0, "reasoning_tokens": 0, "errors": 0}
_lock = threading.Lock()


def available():
    return bool(BASE and KEY)


def chat_json(system, user, effort="low", max_tokens=1500, tag=""):
    """Returns a parsed JSON object, or None if the call failed."""
    h = hashlib.sha256(f"{MODEL}|{effort}|{system}|{user}".encode("utf-8")).hexdigest()[:24]
    f = CACHE / f"{h}.json"
    if f.exists():
        with _lock:
            USAGE["cache_hits"] += 1
        return json.loads(f.read_text(encoding="utf-8"))["out"]
    if not available():
        return None
    body = {
        "model": MODEL,
        "temperature": 0,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    if effort:
        body["reasoning_effort"] = effort
    for attempt in range(3):
        try:
            r = requests.post(f"{BASE}/chat/completions", json=body, headers={"Authorization": f"Bearer {KEY}"}, timeout=120)
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(2 + 3 * attempt)
                continue
            r.raise_for_status()
            j = r.json()
            content = (j["choices"][0]["message"].get("content") or "").strip()
            if content.startswith("```"):
                content = content.strip("`").split("\n", 1)[-1]
            out = json.loads(content)
            u = j.get("usage", {})
            with _lock:
                USAGE["calls"] += 1
                USAGE["prompt_tokens"] += u.get("prompt_tokens", 0)
                USAGE["completion_tokens"] += u.get("completion_tokens", 0)
                USAGE["reasoning_tokens"] += (u.get("completion_tokens_details") or {}).get("reasoning_tokens", 0)
            f.write_text(json.dumps({"tag": tag, "effort": effort, "usage": u, "out": out}, ensure_ascii=False), encoding="utf-8")
            return out
        except Exception:
            time.sleep(1 + attempt)
    with _lock:
        USAGE["errors"] += 1
    return None
