#!/usr/bin/env python3
"""
pneuma_scorer.py — long-lived styxx scoring subprocess.

reads JSON lines from stdin, writes JSON lines to stdout. one line per
request, one line per response. correlation via 'id' field.

protocol:
    request:  {"id": "...", "prompt": "...", "response": "...",
               "turns": [...]?}
    response: {"id": "...", "scores": {sycophancy: float, deception: float,
               overconfidence: float, goal_drift: float, ...}}
    error:    {"id": "...", "error": "..."}

styxx scoring is calibrating in 7.0.0rc3 — raw scores can sit uniformly
high for some instruments. pneuma displays them as-is (honest), and we'll
calibrate the visual mapping in subsequent versions.
"""
import json
import sys
import traceback

# stay quiet on import — anything to stdout that isn't a json response
# breaks the protocol
try:
    from styxx.attack import score_all, list_instruments
    AVAILABLE = list_instruments()
except Exception as e:
    print(json.dumps({
        "id": "_init",
        "error": f"styxx import failed: {e}",
        "traceback": traceback.format_exc(),
    }), flush=True)
    sys.exit(1)

# announce ready
print(json.dumps({
    "id": "_ready",
    "instruments": AVAILABLE,
    "version": "7.0.0rc3",
}), flush=True)


def score_one(req: dict) -> dict:
    """score one request. returns response dict (no flushing)."""
    rid = req.get("id", "?")
    prompt = req.get("prompt") or None
    response = req.get("response") or None
    turns = req.get("turns") or None
    plan = req.get("plan") or None
    action = req.get("action") or None
    try:
        scores = score_all(
            prompt=prompt,
            response=response,
            turns=turns,
            plan=plan,
            action=action,
        )
        # ensure all values are float (json-serializable)
        scores = {k: float(v) for k, v in scores.items()}
        return {"id": rid, "scores": scores}
    except Exception as e:
        return {"id": rid, "error": str(e)}


def main():
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            print(json.dumps({
                "id": "?",
                "error": f"bad json: {e}",
            }), flush=True)
            continue
        if req.get("op") == "shutdown":
            break
        out = score_one(req)
        print(json.dumps(out), flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
