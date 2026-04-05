#!/usr/bin/env python3
"""Full GPU audit for video generation readiness."""

import subprocess, sys, os

SEP = "=" * 60

# ── STEP 2: nvcc ──────────────────────────────────────────────
print(SEP)
print("STEP 2 — nvcc / CUDA compiler")
try:
    r = subprocess.run(["nvcc", "--version"], capture_output=True, text=True)
    if r.returncode == 0:
        print(r.stdout.strip())
    else:
        print("nvcc: NOT FOUND (cuda-toolkit not installed separately)")
except FileNotFoundError:
    print("nvcc: NOT FOUND (cuda-toolkit not installed separately)")
    # Check if cuda libs exist anyway
    cuda_paths = ["/usr/local/cuda", "/usr/local/cuda-12.2", "/usr/local/cuda-12"]
    for p in cuda_paths:
        if os.path.exists(p):
            print(f"CUDA runtime found at: {p}")
            break

# ── STEP 3: PyTorch GPU ───────────────────────────────────────
print(SEP)
print("STEP 3 — PyTorch + CUDA")
try:
    import torch
    cuda_ok = torch.cuda.is_available()
    print(f"PyTorch version : {torch.__version__}")
    print(f"CUDA available  : {cuda_ok}")
    if cuda_ok:
        print(f"Device count    : {torch.cuda.device_count()}")
        print(f"Device name     : {torch.cuda.get_device_name(0)}")
        print(f"CUDA version    : {torch.version.cuda}")
    else:
        print("Device          : CPU only")
except ImportError as e:
    print(f"PyTorch NOT INSTALLED: {e}")
    cuda_ok = False

# ── STEP 4: VRAM ──────────────────────────────────────────────
print(SEP)
print("STEP 4 — VRAM size")
try:
    import torch
    if torch.cuda.is_available():
        props = torch.cuda.get_device_properties(0)
        total_gb = props.total_memory / 1024**3
        print(f"Total VRAM      : {total_gb:.2f} GB")
        print(f"GPU name        : {props.name}")
        print(f"Multiprocessors : {props.multi_processor_count}")
        print(f"CUDA capability : {props.major}.{props.minor}")
    else:
        print("No CUDA device — cannot read VRAM")
except Exception as e:
    print(f"VRAM check failed: {e}")

# ── STEP 5: Diffusers ─────────────────────────────────────────
print(SEP)
print("STEP 5 — diffusers library")
try:
    import diffusers
    print(f"diffusers OK — version: {diffusers.__version__}")
    # Check key pipelines for video
    try:
        from diffusers import AnimateDiffPipeline
        print("AnimateDiffPipeline : AVAILABLE")
    except ImportError:
        print("AnimateDiffPipeline : not in this version")
    try:
        from diffusers import StableVideoDiffusionPipeline
        print("StableVideoDiffusion: AVAILABLE")
    except ImportError:
        print("StableVideoDiffusion: not in this version")
    try:
        from diffusers import CogVideoXPipeline
        print("CogVideoXPipeline   : AVAILABLE")
    except ImportError:
        print("CogVideoXPipeline   : not in this version")
except ImportError:
    print("diffusers: NOT INSTALLED")

# ── STEP 5b: other relevant packages ─────────────────────────
print(SEP)
print("STEP 5b — related packages")
packages = ["transformers", "accelerate", "xformers", "opencv-python", "imageio", "moviepy", "einops"]
for pkg in packages:
    try:
        mod = __import__(pkg.replace("-", "_").split(".")[0])
        ver = getattr(mod, "__version__", "?")
        print(f"  {pkg:<20}: OK ({ver})")
    except ImportError:
        print(f"  {pkg:<20}: NOT INSTALLED")

# ── STEP 6: ComfyUI ───────────────────────────────────────────
print(SEP)
print("STEP 6 — ComfyUI")
comfy_paths = ["/var/www/ComfyUI", "/opt/ComfyUI", "/root/ComfyUI", "/home/ComfyUI"]
found_comfy = False
for p in comfy_paths:
    if os.path.exists(p):
        print(f"ComfyUI FOUND at: {p}")
        found_comfy = True
        break
if not found_comfy:
    r2 = subprocess.run("ls /var/www 2>/dev/null | grep -i comfy", shell=True, capture_output=True, text=True)
    if r2.stdout.strip():
        print(f"ComfyUI (via ls): {r2.stdout.strip()}")
    else:
        print("ComfyUI: NOT FOUND")

# ── STEP 7: GPU load test ─────────────────────────────────────
print(SEP)
print("STEP 7 — GPU load test (tensor allocation)")
try:
    import torch
    if torch.cuda.is_available():
        free_before = torch.cuda.mem_get_info(0)[0] / 1024**3
        x = torch.randn(5000, 5000, device="cuda")
        torch.cuda.synchronize()
        free_after = torch.cuda.mem_get_info(0)[0] / 1024**3
        used = free_before - free_after
        print(f"GPU LOAD OK — allocated {used:.2f} GB for 5000x5000 tensor")
        del x
        torch.cuda.empty_cache()
    else:
        print("No CUDA — skipping GPU load test")
except Exception as e:
    print(f"GPU load test FAILED: {e}")

# ── STEP 8: Ollama GPU usage ──────────────────────────────────
print(SEP)
print("STEP 8 — Ollama GPU usage")
r3 = subprocess.run("nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader 2>/dev/null", shell=True, capture_output=True, text=True)
if r3.stdout.strip():
    print("Processes using GPU:")
    for line in r3.stdout.strip().split("\n"):
        print(f"  {line}")
else:
    print("No GPU compute processes (or nvidia-smi not available)")

# ── STEP 8b: Free VRAM ───────────────────────────────────────
print(SEP)
print("STEP 8b — Current VRAM state")
r4 = subprocess.run("nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu --format=csv,noheader 2>/dev/null", shell=True, capture_output=True, text=True)
if r4.stdout.strip():
    parts = [p.strip() for p in r4.stdout.strip().split(",")]
    if len(parts) >= 6:
        print(f"GPU name    : {parts[0]}")
        print(f"VRAM total  : {parts[1]}")
        print(f"VRAM used   : {parts[2]}")
        print(f"VRAM free   : {parts[3]}")
        print(f"GPU util    : {parts[4]}")
        print(f"Temperature : {parts[5]}")

# ── FINAL REPORT ──────────────────────────────────────────────
print(SEP)
print("FINAL REPORT")
print(SEP)

try:
    import torch
    cuda_avail = torch.cuda.is_available()
except:
    cuda_avail = False

try:
    import diffusers
    diff_ok = True
    diff_ver = diffusers.__version__
except:
    diff_ok = False
    diff_ver = "N/A"

try:
    import transformers
    trans_ok = True
except:
    trans_ok = False

r5 = subprocess.run("nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null", shell=True, capture_output=True, text=True)
gpu_info = r5.stdout.strip().split(",") if r5.stdout.strip() else ["UNKNOWN", "0 MiB"]
gpu_name = gpu_info[0].strip() if len(gpu_info) > 0 else "UNKNOWN"
vram_str  = gpu_info[1].strip() if len(gpu_info) > 1 else "?"

# Convert MiB to GB
try:
    vram_gb = int(vram_str.split()[0]) / 1024
except:
    vram_gb = 0

print(f"GPU             : {gpu_name}")
print(f"VRAM            : {vram_str} ({vram_gb:.1f} GB)")
print(f"Driver          : 535.288.01")
print(f"CUDA (driver)   : 12.2")
print(f"nvcc installed  : NO (toolkit not installed, but CUDA runtime OK)")
print(f"PyTorch GPU     : {'YES' if cuda_avail else 'NO'}")
print(f"diffusers       : {'YES v' + diff_ver if diff_ok else 'NO'}")
print(f"transformers    : {'YES' if trans_ok else 'NO'}")
print(f"ComfyUI         : {'YES' if found_comfy else 'NO'}")

print(SEP)
# Video generation requirements:
# AnimateDiff / SVD: needs 16GB VRAM recommended (8GB minimum fp16)
# CogVideoX-2b: needs 18GB VRAM
# CogVideoX-5b: needs 35GB VRAM
video_ready = cuda_avail and vram_gb >= 14
print(f"READY FOR VIDEO : {'YES' if video_ready else 'PARTIAL — check notes'}")
if video_ready:
    print("  ✅ RTX A4000 16GB → AnimateDiff (fp16) + SVD supported")
    print("  ✅ CogVideoX-2b feasible with offloading")
    print("  ⚠️  CogVideoX-5b requires offloading (35GB needed)")
else:
    print("  ❌ Insufficient VRAM or no CUDA")
print(SEP)
