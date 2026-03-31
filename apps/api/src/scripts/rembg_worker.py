#!/usr/bin/env python3
"""
rembg_worker.py — background removal microservice.
Reads image path from stdin args, writes transparent PNG to output path.
Usage: python3 rembg_worker.py <input_path> <output_path>
"""
import sys
import os

def main():
    if len(sys.argv) < 3:
        print("ERROR: usage: rembg_worker.py <input> <output>", file=sys.stderr)
        sys.exit(1)

    inp = sys.argv[1]
    out = sys.argv[2]

    if not os.path.exists(inp):
        print(f"ERROR: input file not found: {inp}", file=sys.stderr)
        sys.exit(1)

    try:
        os.environ.setdefault("ORT_LOGGING_LEVEL", "3")
        from rembg import remove
        from PIL import Image
        import io

        with open(inp, "rb") as f:
            data = f.read()

        result = remove(data)

        img = Image.open(io.BytesIO(result)).convert("RGBA")
        img.save(out, "PNG")

        print(f"OK:{out}")
        sys.exit(0)

    except Exception as e:
        print(f"ERROR:{e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
