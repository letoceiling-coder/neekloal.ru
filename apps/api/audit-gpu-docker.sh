#!/bin/bash
# GPU Audit inside ComfyUI Docker container

SEP="============================================================"

echo "$SEP"
echo "DOCKER CONTAINER: comfyui"
echo "$SEP"

# Python version + torch
docker exec comfyui bash -c '
echo "--- Python version ---"
python3 --version 2>/dev/null || python --version 2>/dev/null

echo "--- PyTorch + CUDA ---"
python3 -c "
import torch
print(\"PyTorch version :\", torch.__version__)
print(\"CUDA available  :\", torch.cuda.is_available())
if torch.cuda.is_available():
    print(\"Device name     :\", torch.cuda.get_device_name(0))
    print(\"CUDA version    :\", torch.version.cuda)
    props = torch.cuda.get_device_properties(0)
    print(\"VRAM total      :\", round(props.total_memory/1024**3, 2), \"GB\")
    free, total = torch.cuda.mem_get_info(0)
    print(\"VRAM free       :\", round(free/1024**3, 2), \"GB\")
else:
    print(\"NO CUDA\")
" 2>&1

echo "--- diffusers ---"
python3 -c "
import diffusers
print(\"diffusers OK:\", diffusers.__version__)
try:
    from diffusers import AnimateDiffPipeline
    print(\"AnimateDiffPipeline: AVAILABLE\")
except: print(\"AnimateDiffPipeline: not available\")
" 2>&1

echo "--- related packages ---"
python3 -c "
pkgs = [\"transformers\",\"accelerate\",\"xformers\",\"einops\",\"imageio\",\"moviepy\",\"opencv-python\"]
for p in pkgs:
    try:
        import importlib
        m = importlib.import_module(p.replace(\"-\",\"_\").split(\".\")[0])
        print(p, \": OK\", getattr(m, \"__version__\", \"?\"))
    except ImportError:
        print(p, \": NOT INSTALLED\")
" 2>&1

echo "--- ComfyUI custom nodes (sample) ---"
ls /opt/ComfyUI/custom_nodes 2>/dev/null | head -30

echo "--- GPU load test ---"
python3 -c "
import torch
if torch.cuda.is_available():
    x = torch.randn(5000, 5000, device=\"cuda\")
    torch.cuda.synchronize()
    print(\"GPU LOAD OK - allocated 5000x5000 tensor\")
    del x
    torch.cuda.empty_cache()
else:
    print(\"No CUDA - skip\")
" 2>&1
'
