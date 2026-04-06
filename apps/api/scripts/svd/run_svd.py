#!/usr/bin/env python3
"""
Stable Video Diffusion (image-to-video). Deploy on GPU as /opt/svd/run_svd.py
"""
from __future__ import annotations

import argparse
import os
import sys

MODEL_ID = "stabilityai/stable-video-diffusion-img2vid-xt"

_pipe = None


def _get_pipeline():
    global _pipe
    if _pipe is not None:
        return _pipe
    try:
        import torch
        from diffusers import StableVideoDiffusionPipeline
    except ImportError as e:
        raise RuntimeError(f"Missing dependency: {e}") from e

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    kwargs: dict = {"torch_dtype": dtype}
    if device == "cuda":
        kwargs["variant"] = "fp16"

    pipe = StableVideoDiffusionPipeline.from_pretrained(MODEL_ID, **kwargs)
    if device == "cuda":
        try:
            pipe.enable_model_cpu_offload()
        except Exception:
            pipe.to(device)
    else:
        pipe.to(device)

    if (
        device == "cuda"
        and os.environ.get("SVD_TORCH_COMPILE") == "1"
        and hasattr(pipe, "unet")
    ):
        try:
            pipe.unet = torch.compile(pipe.unet, mode="reduce-overhead")
            print("[SVD] torch.compile(unet) enabled", flush=True)
        except Exception as e:
            print(f"[SVD] torch.compile skipped: {e!s}", flush=True)

    _pipe = pipe
    return _pipe


def run_svd_video(image_path: str, output_path: str, num_frames: int = 14) -> None:
    """Generate MP4 from still image using SVD-XT. Raises on failure."""
    import torch
    from diffusers.utils import export_to_video, load_image

    device = "cuda" if torch.cuda.is_available() else "cpu"
    pipe = _get_pipeline()

    image = load_image(image_path).convert("RGB")
    target_w, target_h = 1024, 576
    if image.size != (target_w, target_h):
        image = image.resize((target_w, target_h))

    nf = max(14, min(25, int(num_frames)))
    generator = torch.Generator(device=device).manual_seed(42)

    print(f"[SVD] run_svd_video device={device} frames={nf}", flush=True)

    dtype = torch.float16 if device == "cuda" else torch.float32
    if device == "cuda":
        with torch.autocast(device_type="cuda", dtype=dtype):
            result = pipe(
                image,
                num_frames=nf,
                decode_chunk_size=8,
                generator=generator,
            )
    else:
        result = pipe(
            image,
            num_frames=nf,
            decode_chunk_size=8,
            generator=generator,
        )

    frames = result.frames[0]
    export_to_video(frames, output_path, fps=7)
    print(f"[SVD] wrote {output_path}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="SVD image-to-video → MP4 (CLI)")
    parser.add_argument("--image", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--frames", type=int, default=14)
    args = parser.parse_args()
    try:
        run_svd_video(args.image, args.output, num_frames=args.frames)
    except Exception as e:
        print(f"[SVD] error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
