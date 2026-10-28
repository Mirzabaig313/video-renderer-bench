# video-renderer-bench

CPU-only render benchmark of three code-driven video renderers on the same 36 s, 1920×1080, 30 fps animated explainer (a message-queue story with narration):

| Folder | Renderer | How it draws frames |
|:--|:--|:--|
| `remotion/` | [Remotion](https://www.remotion.dev) 4.0.529 (React/TypeScript) | Headless Chrome screenshots, FFmpeg encode |
| `hyperframes/` | [HyperFrames](https://github.com/heygen-com/hyperframes) 0.8.181 (HTML + GSAP) | Headless Chrome capture, streaming encode |
| `manimgx/` | [ManimGX](https://github.com/academa-labs/manimgx) 0.1.1 (Manim CE API, Rust core) | wgpu; on Linux without a GPU, Mesa lavapipe (CPU Vulkan) |

All three render the same storyboard with the same timing and the same narration WAVs (`remotion/public/audio/`).

## What the benchmark does

`.github/workflows/bench.yml` runs on GitHub's standard Linux runner (4 vCPU, 16 GB, no GPU on public repos). For each renderer and for 4 and 2 cores, in separate jobs:

1. Installs the renderer from its pinned lockfile.
2. `bench/bench.sh` pins the render to N CPUs with `taskset`, does one untimed warm-up render, then 3 timed renders.
3. Records wall time, peak RSS, CPU steal, and whether all decoded frames are identical across runs.

The summary job prints a table in the run's summary page and uploads `summary.json`. Each job uploads its MP4 and logs.

Run it from the Actions tab (**CPU render benchmark → Run workflow**) or by pushing to `main`.

## Running locally on Linux

```sh
sudo apt-get install ffmpeg            # plus Chrome libraries, see the workflow
(cd remotion && npm ci)
(cd hyperframes && npm ci && mkdir -p project/vendor && cp node_modules/gsap/dist/gsap.min.js project/vendor/)
(cd manimgx && python3.13 -m venv .venv && .venv/bin/pip install -r requirements.txt)
bash bench/bench.sh hyperframes 4      # or remotion / manimgx, any core count
```

## Caveats

- GitHub runner CPUs differ from any given VPS; treat results as an estimate and confirm on the target machine.
- `taskset` limits CPUs, not memory bandwidth or shared cache, so 2-core numbers on a 4-core host are slightly optimistic.
- Fonts: the Remotion and HyperFrames scenes ask for macOS system fonts and fall back to DejaVu/Liberation on Linux, so text looks different from the Mac renders; timing is unaffected in practice.
- GSAP is installed from npm during the job and not redistributed here; check its licence for your own use.

## Licences of the renderers

Remotion: free for individuals and companies with up to 3 employees, company licence above that. HyperFrames: Apache-2.0. ManimGX: MIT code, native wheels GPL-3.0-or-later (bundled x264).
