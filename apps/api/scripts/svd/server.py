#!/usr/bin/env python3
"""
FastAPI SVD service — deploy on GPU as /opt/svd/server.py
Run: cd /opt/svd && uvicorn server:app --host 0.0.0.0 --port 5000
"""
from __future__ import annotations

import asyncio
import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from run_svd import run_svd_video

UPLOAD_DIR = os.environ.get("SVD_UPLOAD_DIR", "/opt/svd/tmp")
OUTPUT_DIR = os.environ.get("SVD_OUTPUT_DIR", "/opt/svd/output")

# Generation timeout inside executor (seconds)
SVD_GENERATION_TIMEOUT_SEC = float(os.environ.get("SVD_GENERATION_TIMEOUT_SEC", "300"))

# Max upload size (bytes)
MAX_UPLOAD_BYTES = int(os.environ.get("SVD_MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))

# Only one GPU job at a time by default (VRAM safety)
_GPU_CONCURRENCY = max(1, int(os.environ.get("SVD_GPU_CONCURRENCY", "1")))
gpu_lock = asyncio.Semaphore(_GPU_CONCURRENCY)

# Cleanup: delete files older than this (seconds)
CLEANUP_MAX_AGE_SEC = int(os.environ.get("SVD_CLEANUP_MAX_AGE_SEC", "3600"))
CLEANUP_INTERVAL_SEC = int(os.environ.get("SVD_CLEANUP_INTERVAL_SEC", "300"))

ALLOWED_CONTENT_TYPES = frozenset({"image/jpeg", "image/png"})
ALLOWED_EXT = {".png", ".jpg", ".jpeg"}

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

UUID_RE = re.compile(
    r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$",
    re.IGNORECASE,
)


def _cleanup_stale_files() -> None:
    """Remove files older than CLEANUP_MAX_AGE_SEC from tmp and output."""
    now = time.time()
    for directory in (UPLOAD_DIR, OUTPUT_DIR):
        try:
            for name in os.listdir(directory):
                full = os.path.join(directory, name)
                if not os.path.isfile(full):
                    continue
                try:
                    if now - os.path.getmtime(full) > CLEANUP_MAX_AGE_SEC:
                        os.remove(full)
                except OSError:
                    pass
        except OSError:
            pass


async def _cleanup_loop() -> None:
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL_SEC)
        try:
            await asyncio.to_thread(_cleanup_stale_files)
        except Exception as e:
            print(f"[SVD] cleanup error: {e!s}", flush=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_cleanup_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="SVD GPU service", version="1.1.0", lifespan=lifespan)


@app.get("/health")
def health():
    return {"ok": True}


async def run_generation(file: UploadFile) -> dict:
    ct = (file.content_type or "").split(";")[0].strip().lower()
    if ct not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Invalid file type (allowed: image/jpeg, image/png)",
        )

    raw_name = file.filename or "upload.png"
    ext = os.path.splitext(raw_name)[1].lower()
    if ext not in ALLOWED_EXT:
        ext = ".png" if ct == "image/png" else ".jpg"

    vid = str(uuid.uuid4())
    input_path = os.path.join(UPLOAD_DIR, f"{vid}{ext}")
    output_path = os.path.join(OUTPUT_DIR, f"{vid}.mp4")

    print(f"[SVD] START {raw_name!r} content_type={ct!r}", flush=True)

    total = 0
    try:
        with open(input_path, "wb") as buffer:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=400, detail="File too large (max 10MB)")
                buffer.write(chunk)
    except HTTPException:
        try:
            if os.path.isfile(input_path):
                os.remove(input_path)
        except OSError:
            pass
        raise

    if total == 0:
        try:
            if os.path.isfile(input_path):
                os.remove(input_path)
        except OSError:
            pass
        raise HTTPException(status_code=400, detail="Empty file")

    loop = asyncio.get_running_loop()

    def _run_svd() -> None:
        run_svd_video(input_path, output_path)

    try:
        await asyncio.wait_for(
            loop.run_in_executor(None, _run_svd),
            timeout=SVD_GENERATION_TIMEOUT_SEC,
        )
    except asyncio.TimeoutError:
        try:
            if os.path.isfile(input_path):
                os.remove(input_path)
            if os.path.isfile(output_path):
                os.remove(output_path)
        except OSError:
            pass
        print("[SVD] TIMEOUT", flush=True)
        raise HTTPException(status_code=500, detail="SVD TIMEOUT") from None
    except Exception as e:
        try:
            if os.path.isfile(input_path):
                os.remove(input_path)
            if os.path.isfile(output_path):
                os.remove(output_path)
        except OSError:
            pass
        print(f"[SVD] FAILED {e!r}", flush=True)
        raise HTTPException(status_code=500, detail=f"SVD failed: {e!s}") from e
    finally:
        try:
            if os.path.isfile(input_path):
                os.remove(input_path)
        except OSError:
            pass

    if not os.path.isfile(output_path):
        raise HTTPException(status_code=500, detail="SVD produced no output file")

    print(f"[SVD] DONE {output_path}", flush=True)
    return {"video_id": vid, "video_path": output_path, "filename": f"{vid}.mp4"}


@app.post("/generate")
async def generate(file: UploadFile = File(...)):
    async with gpu_lock:
        return await run_generation(file)


@app.get("/video/{video_id}")
async def get_video(video_id: str):
    if not UUID_RE.match(video_id or ""):
        raise HTTPException(status_code=400, detail="invalid video_id")
    full = os.path.join(OUTPUT_DIR, f"{video_id}.mp4")
    full = os.path.normpath(full)
    root = os.path.normpath(OUTPUT_DIR)
    if not full.startswith(root + os.sep) and full != root:
        raise HTTPException(status_code=400, detail="invalid path")
    if not os.path.isfile(full):
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(
        full,
        media_type="video/mp4",
        filename=f"{video_id}.mp4",
    )


@app.get("/video")
async def get_video_query(path: Optional[str] = None):
    if not path:
        raise HTTPException(status_code=400, detail="missing path")
    base = os.path.basename(path)
    if not base.endswith(".mp4"):
        raise HTTPException(status_code=400, detail="expected .mp4")
    video_id = base[:-4]
    return await get_video(video_id)
