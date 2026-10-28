#!/usr/bin/env bash
# CPU-only render benchmark for one renderer on N cores (Linux).
# Usage: bench/bench.sh <remotion|hyperframes|manimgx> <cores> [runs=3]
# Pins the process tree to the first N CPUs with taskset, does one untimed warm-up
# render, then RUNS timed renders of the same 36 s, 1920x1080, 30 fps video.
# Writes results/<renderer>-<cores>c.json and keeps the last MP4 in results/.
set -euo pipefail
R="$1"; CORES="$2"; RUNS="${3:-3}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RES="$ROOT/results"; LOGS="$RES/logs"; TMP="$ROOT/.tmp"
mkdir -p "$RES" "$LOGS" "$TMP"
CPUSET="0-$((CORES - 1))"
PIN=(taskset -c "$CPUSET")

case "$R" in
  remotion)
    cd "$ROOT/remotion"
    argv() { ARGS=(npx remotion render src/index.ts Explainer "$1" --codec=h264 --crf=18
      "--concurrency=$CORES" '--props={"captions":false}' --log=error); } ;;
  hyperframes)
    cd "$ROOT/hyperframes"
    export HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_PREVIEW_DISCOVERY=1 HF_CAPTURE_PARALLEL_STREAM=true
    argv() { ARGS=(node_modules/.bin/hyperframes render project -o "$1" --no-browser-gpu
      --experimental-fast-capture=false --workers "$CORES"); } ;;
  manimgx)
    cd "$ROOT/manimgx"
    export LP_NUM_THREADS="$CORES"   # lavapipe (CPU Vulkan) thread count
    argv() { ARGS=(.venv/bin/manimgx render explainer_scene.py ExplainerClean --fps 30 --crf 18 -o "$1"); } ;;
  *) echo "unknown renderer $R" >&2; exit 2 ;;
esac

steal() { awk '/^cpu /{print $9, $2+$3+$4+$5+$6+$7+$8+$9}' /proc/stat; }
frames_digest() { ffmpeg -hide_banner -loglevel error -i "$1" -map 0:v -f framemd5 - | grep -v '^#' | md5sum | cut -d' ' -f1; }

echo "== warm-up ($R, $CORES cores)"
argv "$TMP/warmup.mp4"; "${PIN[@]}" "${ARGS[@]}" > "$LOGS/$R-${CORES}c-warmup.log" 2>&1

walls=(); rss=(); steals=(); digests=()
for n in $(seq 1 "$RUNS"); do
  out="$TMP/run$n.mp4"; log="$LOGS/$R-${CORES}c-run$n.log"
  read -r s0 t0 < <(steal)
  argv "$out"; /usr/bin/time -v -o "$log.time" "${PIN[@]}" "${ARGS[@]}" > "$log" 2>&1
  read -r s1 t1 < <(steal)
  w=$(awk -F': ' '/Elapsed \(wall clock\)/{n=split($2,a,":"); s=0; for(i=1;i<=n;i++) s=s*60+a[i]; print s}' "$log.time")
  m=$(awk -F': ' '/Maximum resident set size/{printf "%.0f", $2/1024}' "$log.time")
  st=$(awk -v a="$s0" -v b="$s1" -v c="$t0" -v d="$t1" 'BEGIN{ if (d>c) printf "%.2f", 100*(b-a)/(d-c); else print 0 }')
  walls+=("$w"); rss+=("$m"); steals+=("$st"); digests+=("$(frames_digest "$out")")
  echo "run $n: ${w}s, rss ${m} MB (process tree peak may be higher), steal ${st}%"
done
cp "$TMP/run$RUNS.mp4" "$RES/$R-${CORES}c.mp4"

dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$RES/$R-${CORES}c.mp4")
fmt=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,nb_frames -of csv=p=0 "$RES/$R-${CORES}c.mp4")
median=$(printf '%s\n' "${walls[@]}" | sort -n | awk '{a[NR]=$1} END{print (NR%2)? a[(NR+1)/2] : (a[NR/2]+a[NR/2+1])/2}')
same=$(printf '%s\n' "${digests[@]}" | sort -u | wc -l)
cpu=$(lscpu | awk -F': +' '/Model name/{print $2; exit}')
json_arr() { local IFS=,; echo "[$*]"; }
cat > "$RES/$R-${CORES}c.json" <<EOF
{
  "renderer": "$R",
  "cores": $CORES,
  "cpu_model": "$cpu",
  "host_cpus": $(nproc --all),
  "runs": $RUNS,
  "wall_s": $(json_arr "${walls[@]}"),
  "median_wall_s": $median,
  "video_s": $dur,
  "realtime_factor": $(awk -v m="$median" -v d="$dur" 'BEGIN{printf "%.2f", m/d}'),
  "max_rss_mb": $(json_arr "${rss[@]}"),
  "steal_pct": $(json_arr "${steals[@]}"),
  "frames_identical_across_runs": $([ "$same" = 1 ] && echo true || echo false),
  "video_stream": "$fmt"
}
EOF
cat "$RES/$R-${CORES}c.json"
