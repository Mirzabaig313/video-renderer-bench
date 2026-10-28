"""Merge results/*.json into one Markdown table (stdout) and results/summary.json."""
import json
import pathlib
import sys

rows = sorted(
    (json.loads(p.read_text()) for p in pathlib.Path(sys.argv[1]).rglob("*c.json")),
    key=lambda r: (r["cores"], r["median_wall_s"]),
)
pathlib.Path(sys.argv[1], "summary.json").write_text(json.dumps(rows, indent=2))
print("| Renderer | Cores | Median render (s) | Runs (s) | Render ÷ video | Est. render time per 10 min | Peak RSS (MB) | Steal % | Identical frames | CPU |")
print("|:--|--:|--:|:--|--:|--:|--:|:--|:-:|:--|")
for r in rows:
    per10 = r["realtime_factor"] * 10
    print(
        f"| {r['renderer']} | {r['cores']} | {r['median_wall_s']:.1f} | {', '.join(f'{w:.1f}' for w in r['wall_s'])} "
        f"| {r['realtime_factor']:.2f}× | {per10:.0f} min | {max(r['max_rss_mb'])} "
        f"| {', '.join(str(s) for s in r['steal_pct'])} | {'yes' if r['frames_identical_across_runs'] else 'no'} | {r['cpu_model']} |"
    )
