"""Deterministic translator: closed-vocabulary storyboard -> ManimGX scene.

Reads storyboard.json (the storyboard the model would author) and narration.json (measured
audio + word marks, copied from the Remotion prototype), validates them against a closed
vocabulary, computes the same timing model as remotion/src/timeline.ts and
the same message schedule as src/sim.ts, and writes:

  generated/plan.json         timeline, cues, captions, message schedule (data for recipes.py)
  explainer_scene.py          a flat list of recipe calls at absolute times (no logic)

The model never writes Python: it can only pick recipes, cue words and paces listed here.
Same input -> byte-identical output.

Usage: python storyboard_to_scene.py [--check]
  --check  also asserts the port matches the Remotion baseline (total frames, captions).
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REMOTION = ROOT.parent / "remotion"
OUT = ROOT / "generated"

RECIPES = {
    "writeTitle", "indicate", "dockTitle", "buildPipeline", "streamMessages",
    "crash", "zoomAndOpen", "codeHighlight", "redeliver", "recap",
}

# Message schedule constants, in 30 fps frames (src/sim.ts).
T_PB, T_BC, PROC, T_ACK, SERVICE = 24, 20, 9, 12, 12


def words_of(text: str) -> list[str]:
    return text.split()


def validate(sb: dict, nar: dict) -> None:
    seen: set[str] = set()
    assert len(sb["scenes"]) == len(nar["scenes"]), "narration scene count differs"
    for scene, audio in zip(sb["scenes"], nar["scenes"], strict=True):
        assert audio["id"] == scene["id"], f"narration missing for {scene['id']}"
        n = len(words_of(scene["spoken_text"]))
        assert len(audio["marks"]) == n, f"narration for {scene['id']} is stale"
        assert scene["hold_after"] in sb["hold_ms"], f"unknown hold {scene['hold_after']}"
        for cue in scene["cues"]:
            assert cue["do"] in RECIPES, f"cue {cue['id']}: unknown recipe {cue['do']}"
            assert cue["pace"] in sb["pace_ms"], f"cue {cue['id']}: unknown pace {cue['pace']}"
            assert 0 <= cue["word"] < n, f"cue {cue['id']} targets a word outside {scene['id']}"
            assert re.fullmatch(r"[a-z_]+", cue["id"]), f"bad cue id {cue['id']}"
            assert cue["id"] not in seen, f"duplicate cue id {cue['id']}"
            seen.add(cue["id"])


def build_timeline(sb: dict, nar: dict) -> dict:
    fps, tm = sb["fps"], sb["timing"]
    ms_to_frame = lambda ms: round(ms * fps / 1000)  # noqa: E731  (JS Math.round on positives)
    cursor = tm["opening_ms"]
    scenes, cues, words = [], {}, []
    for scene, audio in zip(sb["scenes"], nar["scenes"], strict=True):
        start = cursor
        scenes.append({
            "id": scene["id"],
            "audio": audio["audio"],
            "start_frame": ms_to_frame(start),
            "audio_from": ms_to_frame(start + tm["pad_in_ms"]),
        })
        base = start + tm["pad_in_ms"]
        for mk in audio["marks"]:
            words.append({"scene": scene["id"], "text": mk["text"],
                          "start_ms": base + mk["start_ms"], "end_ms": base + mk["end_ms"]})
        for cue in scene["cues"]:
            word_ms = base + audio["marks"][cue["word"]]["start_ms"]
            cues[cue["id"]] = {
                "id": cue["id"], "scene": scene["id"], "do": cue["do"],
                "frame": max(0, math.floor(word_ms * fps / 1000) - tm["lead_frames"]),
                "frames": round(sb["pace_ms"][cue["pace"]] * fps / 1000),
            }
        cursor += tm["pad_in_ms"] + audio["audio_ms"] + tm["pad_out_ms"] + sb["hold_ms"][scene["hold_after"]]
    return {"fps": fps, "total_frames": ms_to_frame(cursor), "scenes": scenes, "cues": cues,
            "captions": build_captions(words)}


def _wrap(ws: list[str], mx: int = 42) -> list[str]:
    lines: list[str] = []
    for w in ws:
        if lines and len(lines[-1] + " " + w) <= mx:
            lines[-1] += " " + w
        else:
            lines.append(w)
    if len(lines) != 2:
        return lines
    score = lambda p: max(len(x) for x in p) - (10 if p[0].endswith(",") else 0)  # noqa: E731
    best = lines
    for i in range(1, len(ws)):
        pair = [" ".join(ws[:i]), " ".join(ws[i:])]
        if all(len(x) <= mx for x in pair) and score(pair) < score(best):
            best = pair
    return best


def build_captions(words: list[dict]) -> list[dict]:
    """Port of timeline.ts buildCaptions: sentence breaks, 42 chars per line, 2 lines."""
    out: list[dict] = []
    group: list[dict] = []

    def flush() -> None:
        nonlocal group
        if group:
            out.append({"start_ms": group[0]["start_ms"], "end_ms": group[-1]["end_ms"] + 250,
                        "lines": _wrap([g["text"] for g in group])})
        group = []

    for w in words:
        prev = group[-1] if group else None
        too_long = len(_wrap([g["text"] for g in group + [w]])) > 2
        if prev and (prev["scene"] != w["scene"] or too_long or w["end_ms"] - group[0]["start_ms"] > 7000):
            comma = next((i for i in range(len(group) - 2, 0, -1) if group[i]["text"].endswith(",")), -1)
            rest = group[comma + 1:] if prev["scene"] == w["scene"] and comma > 0 else []
            if rest:
                group = group[:comma + 1]
            flush()
            group = rest
        group.append(w)
        if re.search(r"[.?!]$", w["text"]):
            flush()
    flush()
    for c, nxt in zip(out, out[1:]):
        c["end_ms"] = min(c["end_ms"], nxt["start_ms"])
    return out


def build_sim(tl: dict) -> dict:
    """Port of src/sim.ts: deterministic message schedule from cue frames."""
    f = {k: v["frame"] for k, v in tl["cues"].items()}
    stream, fill, drain, crash = f["stream"], f["fill"], f["drain"], f["crash"]
    recover, redeliver, ack, end = f["recover"], f["redeliver"], f["ack"], tl["total_frames"]
    spawns, s = [], stream - T_PB + 2
    while s < recover:
        spawns.append(s)
        s += 16 if s < fill - T_PB else 3 if s < drain - 18 else 30 if s < crash else 64
    msgs = [{"i": i, "label": f'{{"order": {1040 + i}}}', "spawn": sp, "arrive": sp + T_PB,
             "deliveries": [], "ack_start": None, "ack_arrive": None, "victim": False}
            for i, sp in enumerate(spawns)]
    last_normal, free, k = crash - T_BC - PROC - 2, stream, 0
    while k < len(msgs):
        m = msgs[k]
        d = max(m["arrive"], free)
        if d > last_normal:
            break
        m["deliveries"].append(d)
        m["ack_start"] = d + T_BC + PROC
        m["ack_arrive"] = m["ack_start"] + T_ACK
        free = d + SERVICE
        k += 1
    assert k < len(msgs), "no message left to be the victim"
    v = msgs[k]
    v["victim"] = True
    v["deliveries"] += [max(v["arrive"], crash - T_BC - 3), redeliver]
    v["ack_arrive"] = ack + 3
    v["ack_start"] = v["ack_arrive"] - T_ACK
    free = v["ack_arrive"] + 4
    for m in msgs[k + 1:]:
        d = max(m["arrive"], free)
        if d > end:
            break
        m["deliveries"].append(d)
        m["ack_start"] = d + T_BC + PROC
        m["ack_arrive"] = m["ack_start"] + T_ACK
        free = d + SERVICE + 4
    return {"T_PB": T_PB, "T_BC": T_BC, "PROC": PROC, "T_ACK": T_ACK, "victim": k,
            "crash": crash, "recover": recover, "msgs": msgs}


def beats(tl: dict) -> list[tuple[int, list[tuple[str, str, int, int]]]]:
    """Group cues that overlap in time into one play.

    Returns (start_frame, [(recipe, cue, delay_frames, frames), ...]) per play, so every cue
    still starts on its own frame and runs its full pace.
    """
    out: list[tuple[int, list[tuple[str, str, int, int]]]] = []
    end = -1
    for c in sorted(tl["cues"].values(), key=lambda c: (c["frame"], c["id"])):
        if out and c["frame"] < end:
            out[-1][1].append((c["do"], c["id"], c["frame"] - out[-1][0], c["frames"]))
        else:
            out.append((c["frame"], [(c["do"], c["id"], 0, c["frames"])]))
        end = max(end, c["frame"] + c["frames"])
    return out


def emit_scene(tl: dict) -> str:
    fps = tl["fps"]
    groups = beats(tl)
    lines = [
        "# GENERATED by storyboard_to_scene.py from storyboard.json + narration.json. Do not edit.",
        "# Only recipe calls with literal arguments; all drawing lives in recipes.py.",
        "import manimgx as m",
        "",
        "from recipes import World",
        "",
        "",
        "class Explainer(m.Scene):",
        "    captions = True",
        "",
        "    def construct(self) -> None:",
        "        w = World(self, captions=self.captions)",
    ]
    for s in tl["scenes"]:
        lines.append(f"        w.narrate({s['audio']!r}, {s['audio_from']}/{fps})")
    for start, b in groups:
        calls = ", ".join(f"({r!r}, {i!r}, {d}/{fps}, {n}/{fps})" for r, i, d, n in b)
        lines.append(f"        w.at({start}/{fps})")
        lines.append(f"        w.beat([{calls}])")
    lines += [f"        w.at({tl['total_frames']}/{fps})", "", "",
              "class ExplainerClean(Explainer):", "    captions = False", ""]
    return "\n".join(lines)


def main() -> None:
    sb = json.loads((ROOT / "storyboard.json").read_text())
    nar = json.loads((ROOT / "narration.json").read_text())
    validate(sb, nar)
    tl = build_timeline(sb, nar)
    plan = {**tl, "title": sb["title"], "sim": build_sim(tl)}
    OUT.mkdir(exist_ok=True)
    (OUT / "plan.json").write_text(json.dumps(plan, indent=1) + "\n")
    (ROOT / "explainer_scene.py").write_text(emit_scene(tl))
    print(f"{tl['total_frames']} frames, {len(tl['cues'])} cues, {len(plan['sim']['msgs'])} messages")
    if "--check" in sys.argv:
        report = json.loads((REMOTION / "out" / "render-report.json").read_text())
        assert tl["total_frames"] == report["frames"], (tl["total_frames"], report["frames"])
        vtt = (REMOTION / "out" / "explainer.vtt").read_text()
        cues = re.findall(r"(\d\d):(\d\d):(\d\d)\.(\d{3}) --> (\d\d):(\d\d):(\d\d)\.(\d{3})\n(.*?)\n\n", vtt + "\n", re.S)
        assert len(cues) == len(tl["captions"]), (len(cues), len(tl["captions"]))
        for c, ref in zip(tl["captions"], cues, strict=True):
            ms = lambda h, mi, s, f: ((int(h) * 60 + int(mi)) * 60 + int(s)) * 1000 + int(f)  # noqa: E731
            assert abs(ms(*ref[0:4]) - c["start_ms"]) <= 1 and abs(ms(*ref[4:8]) - c["end_ms"]) <= 1, (c, ref)
            assert ref[8].split("\n") == c["lines"], (c["lines"], ref[8])
        print("check ok: total frames and all captions match the Remotion baseline")


if __name__ == "__main__":
    main()
