#!/usr/bin/env python3
"""
detect_human.py — face + full-body heuristics on RGBA image (after rembg).
Prints one JSON line to stdout: {"reject":bool,"faces":int,"persons":int,"skipped":bool,"reason":str?}
Exit 0 always; Node interprets reject.

Requires: opencv-python-headless (optional). If missing: skipped=true, reject=false.
"""
import json
import sys
import os

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"reject": False, "faces": 0, "persons": 0, "skipped": True, "reason": "no_args"}))
        sys.exit(0)

    path = sys.argv[1]
    if not os.path.exists(path):
        print(json.dumps({"reject": True, "faces": 0, "persons": 0, "skipped": False, "reason": "file_not_found"}))
        sys.exit(0)

    try:
        import cv2
        import numpy as np
    except ImportError:
        print(json.dumps({
            "reject": False,
            "faces": 0,
            "persons": 0,
            "skipped": True,
            "reason": "opencv_not_installed",
        }))
        sys.exit(0)

    try:
        # Load with alpha
        img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
        if img is None:
            print(json.dumps({"reject": True, "faces": 0, "persons": 0, "skipped": False, "reason": "imread_failed"}))
            sys.exit(0)

        if len(img.shape) < 2:
            print(json.dumps({"reject": False, "faces": 0, "persons": 0, "skipped": True, "reason": "bad_shape"}))
            sys.exit(0)

        h, w = img.shape[:2]
        if img.shape[2] == 4:
            bgr = img[:, :, :3]
            alpha = img[:, :, 3]
            # ignore fully transparent pixels for detectors: composite on white
            bg = np.ones_like(bgr, dtype=np.uint8) * 255
            a = (alpha.astype(np.float32) / 255.0)[:, :, np.newaxis]
            rgb = (bgr.astype(np.float32) * a + bg.astype(np.float32) * (1 - a)).astype(np.uint8)
        else:
            rgb = img[:, :, :3]

        gray = cv2.cvtColor(rgb, cv2.COLOR_BGR2GRAY)

        face_cascade_path = os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
        face_cascade = cv2.CascadeClassifier(face_cascade_path)
        if face_cascade.empty():
            print(json.dumps({"reject": False, "faces": 0, "persons": 0, "skipped": True, "reason": "no_haar"}))
            sys.exit(0)

        min_f = max(24, min(w, h) // 40)
        faces = face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.08,
            minNeighbors=4,
            minSize=(min_f, min_f),
        )
        n_faces = len(faces) if faces is not None else 0

        hog = cv2.HOGDescriptor()
        hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
        rects, weights = hog.detectMultiScale(
            rgb,
            winStride=(8, 8),
            padding=(16, 16),
            scale=1.03,
        )
        n_persons = 0
        if rects is not None and len(rects) and weights is not None and len(weights):
            for i, rect in enumerate(rects):
                if i >= len(weights):
                    break
                wt = float(weights[i][0]) if hasattr(weights[i], "__len__") else float(weights[i])
                if wt < 0.45:
                    continue
                rx, ry, rw, rh = [int(x) for x in rect]
                if rw >= max(48, w // 12) and rh >= max(96, h // 10):
                    n_persons += 1

        reject = (n_faces > 0) or (n_persons > 0)
        reason = ""
        if reject:
            reason = "face" if n_faces > 0 else "body"
            if n_faces > 0 and n_persons > 0:
                reason = "face_and_body"

        print(json.dumps({
            "reject": reject,
            "faces": int(n_faces),
            "persons": int(n_persons),
            "skipped": False,
            "reason": reason,
        }))
        sys.exit(0)

    except Exception as e:
        print(json.dumps({
            "reject": False,
            "faces": 0,
            "persons": 0,
            "skipped": True,
            "reason": "error:" + str(e)[:120],
        }))
        sys.exit(0)


if __name__ == "__main__":
    main()
