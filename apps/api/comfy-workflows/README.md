# ComfyUI LTX — API workflow (image → video)

The video worker (`mode: "ltx"`) loads **ComfyUI API JSON** from:

- `VIDEO_COMFY_LTX_API_WORKFLOW_PATH` (absolute path on the API host), or  
- default: `apps/api/comfy-workflows/ltx_image_to_video.api.json`

## Export from ComfyUI

1. Install **ComfyUI-LTXVideo** (or Lightricks fork) on the GPU host and open the I2V graph.
2. In ComfyUI use **Save (API Format)** and save the graph as `ltx_image_to_video.api.json`.
3. Copy that file to this folder on the API server (or set `VIDEO_COMFY_LTX_API_WORKFLOW_PATH`).

The JSON must be the **API** graph (`{ "1": { "class_type": "...", "inputs": {} } }`), not the UI graph with `"nodes": []`.

## Injection

At runtime the worker sets:

- **LoadImage** → `inputs.image` = uploaded filename  
- **CLIPTextEncode** (positive) → `inputs.text` = `cinematic motion, {script}, smooth camera movement`

If there are multiple CLIP encodes, set:

```bash
VIDEO_LTX_CLIP_POSITIVE_NODE_ID=2483
```

(use the string node id from your API export).

## Validation

The worker checks that the API graph includes **LoadImage**, **CLIPTextEncode**, at least one **LTX** `class_type`, and **SaveVideo** / **CreateVideo** (video sink). UI-only exports are rejected.

## Environment

| Variable | Meaning |
|----------|---------|
| `VIDEO_ALLOW_LTX_FALLBACK` | Set to `1` to allow ffmpeg **zoompan** if Comfy fails (no real AI motion). Default: **unset / not 1** → job **fails** until Comfy LTX works. |
| `VIDEO_COMFY_VERIFY_LTX_NODES` | Set to `1` to fail fast if `GET /object_info` on Comfy has **no** LTX node names (custom nodes not installed). |

## GPU host (reference)

Target ComfyUI: `http://188.124.55.89:8188` — override with `VIDEO_COMFY_URL` or `COMFYUI_URL`.

**Requirement:** ComfyUI must expose LTX nodes (`curl …/object_info` should list class types containing `LTX`). If not, install **ComfyUI-LTXVideo** in the Comfy container and restart ComfyUI.

See also: `docs/COMFY_LTX_SERVER.md`.
