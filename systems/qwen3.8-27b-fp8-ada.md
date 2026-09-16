# Qwen3.8-27B on one RTX 6000 Ada

This is a separate, hardware-constrained experimental system, not a replacement
for the existing Qwen3.8 Flash contestant or the completed 60-outcome cohort.
Start with one trial, with no concurrent generation sessions.

## Serving contract

- GPU: one NVIDIA RTX 6000 Ada, 49,140 MiB reported by `nvidia-smi`.
- Driver: 580.126.16, CUDA compatibility 13.0.
- Massed Compute product: `gpu_1x_6000_ada`, image 184, $0.79/hour.
- Checkpoint: `Qwen/Qwen3.8-27B-FP8`, revision
  `017b9c7af6b5689d5dd426a76e0bc077eb5ca20a`.
- vLLM: 0.29.0, Docker image
  `vllm/vllm-openai@sha256:c2914767605584b6d8f45686b82de173ecc99e781897aa3d0a66dacd72c51ae1`.
- FP8 weights; vLLM selects `MarlinFP8ScaledMMLinearKernel` on this GPU.
  This is weight-only FP8 compression, not a claim of native FP8 arithmetic.
- BF16 KV cache (`--kv-cache-dtype auto` with BF16 model dtype). An initial
  FP8-cache startup warned about uncalibrated scales and was stopped before
  any inference; do not use that configuration for scored trials.
- Text only, 131,072-token context, one sequence, 90% GPU memory utilization.
  The context cap is deliberately below the model's native 262,144 tokens.
- No speculative decoding. Model-recommended generation defaults come from
  the pinned checkpoint; record effective settings from serving/session logs.

Server arguments:

```sh
Qwen/Qwen3.8-27B-FP8 \
  --revision 017b9c7af6b5689d5dd426a76e0bc077eb5ca20a \
  --max-model-len 131072 --max-num-seqs 1 \
  --gpu-memory-utilization 0.90 --kv-cache-dtype auto \
  --language-model-only --reasoning-parser qwen3 \
  --enable-auto-tool-choice --tool-call-parser qwen3_coder \
  --host 0.0.0.0 --port 8000
```

Docker publishes port 8000 only on the VM's loopback interface. An SSH tunnel
exposes it only on the benchmark host's loopback port 18000. Do not publish an
unauthenticated inference endpoint on the Internet or copy cloud credentials
into the contestant environment.

## Benchmark contract

Use `qwen3.8-27b-fp8-ada-opencode.json`: OpenCode 1.18.25, OpenWiki 0.4.3,
the unchanged build-agent prompt and failure policy, a 32,768-token output
limit, and the existing three-hour trial timeout. Export the full session and
verify the exact resolved provider/model. Smoke tests are not official trials.

```sh
npm run bench -- run --subject smallstep-cli \
  --system systems/qwen3.8-27b-fp8-ada-opencode.json --seed 0 \
  --prompt prompts/code-wiki.md --ignore prompts/official.openwikiignore
```

## Economics and comparison

The provider has no token price. OpenCode may report zero token cost; that is
**not** the experiment's cost. Report rental separately, including provisioning,
downloads, compilation, smoke tests, and idle time. Estimate elapsed rental as
hours × $0.79 and distinguish it from the provider's final invoice/minimum charge.
Do not insert a fabricated per-token price into the existing cost metrics.

One trial provides a smoke comparison, not a statistical ranking. Keep the
existing cohorts unchanged; a complete new contestant requires three trials
on each of five pinned subjects and the same blind judging/probe protocol.
