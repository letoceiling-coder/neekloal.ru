# ComfyUI + LTX on GPU (188.124.55.89)

These steps run **on the GPU server** (not in this repo’s deploy script). They install LTX nodes and models so the API can call `POST /prompt` on ComfyUI.

## 1. Enter the container

```bash
docker exec -it comfyui bash
```

## 2. Install ComfyUI-LTXVideo

```bash
cd /opt/ComfyUI/custom_nodes
git clone https://github.com/kijai/ComfyUI-LTXVideo.git
pip install -r ComfyUI-LTXVideo/requirements.txt || true
```

(Alternatively use [Lightricks/ComfyUI-LTXVideo](https://github.com/Lightricks/ComfyUI-LTXVideo) if that matches your workflow export.)

## 3. Models directory

```bash
mkdir -p /opt/ComfyUI/models/ltx
```

Download weights from [Hugging Face — Lightricks/LTX-2.3](https://huggingface.co/Lightricks/LTX-2.3) into the paths expected by your workflow (see the model loaders in the graph).

## 4. Workflow file on the host

Save the ComfyUI **API** export as:

```text
/opt/ComfyUI/workflows/ltx_image_to_video.json
```

Copy the same file to the **API** machine as `ltx_image_to_video.api.json` (see `apps/api/comfy-workflows/README.md`) or set `VIDEO_COMFY_LTX_API_WORKFLOW_PATH`.

## 5. Verify nodes

```bash
curl -sS http://127.0.0.1:8188/object_info | head -c 2000
```

Confirm LTX-related nodes appear in the listing.

## 6. Restart ComfyUI

```bash
docker restart comfyui
```

## API environment (Node worker)

| Variable | Purpose |
|----------|---------|
| `VIDEO_COMFY_URL` / `COMFYUI_URL` | Base URL (default `http://188.124.55.89:8188`) |
| `VIDEO_COMFY_LTX_API_WORKFLOW_PATH` | Path to API JSON workflow |
| `VIDEO_LTX_CLIP_POSITIVE_NODE_ID` | Optional: CLIP positive node id string |
| `VIDEO_COMFY_LTX_TIMEOUT_MS` | Queue wait timeout (default 600000) |
| `VIDEO_LTX_INTERPOLATE` | Set `0` to skip `minterpolate` |
| `VIDEO_LTX_UPSCALE` | Set `1` to enable 2× upscale |
| `FFMPEG_PATH` | `ffmpeg` binary |

If the workflow file is missing or ComfyUI fails, the worker **falls back** to the legacy HTTP LTX endpoint / ffmpeg zoompan (unchanged).
