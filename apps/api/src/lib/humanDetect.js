"use strict";

/**
 * Run detect_human.py on a PNG buffer; fail catalog pipeline if face/body detected.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const SCRIPT_PATH = path.join(__dirname, "../scripts/detect_human.py");
const TIMEOUT_MS = Number(process.env.IMAGE_HUMAN_DETECT_TIMEOUT_MS) || 45_000;

/**
 * @param {Buffer} rgbaPngBuffer
 * @throws {Error} if face/body confidently detected (OpenCV available)
 */
async function assertCatalogNoHuman(rgbaPngBuffer) {
  const id = uuidv4();
  const tmp = path.join(os.tmpdir(), `catalog_human_${id}.png`);
  fs.writeFileSync(tmp, rgbaPngBuffer);

  return new Promise((resolve, reject) => {
    execFile(
      PYTHON_BIN,
      [SCRIPT_PATH, tmp],
      { timeout: TIMEOUT_MS, env: process.env },
      (error, stdout) => {
        try {
          if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        } catch { /* ignore */ }

        if (error) {
          process.stderr.write(`[humanDetect] exec error: ${error.message} — пропуск проверки\n`);
          return resolve();
        }

        const line = (stdout || "").trim().split("\n").pop() || "{}";
        let data;
        try {
          data = JSON.parse(line);
        } catch {
          process.stderr.write(`[humanDetect] bad JSON: ${line.slice(0, 200)}\n`);
          return resolve();
        }

        if (data.skipped) {
          process.stdout.write(
            `[humanDetect] skipped reason=${data.reason || "?"} (pip install opencv-python-headless для проверки)\n`
          );
          return resolve();
        }

        if (data.reject) {
          return reject(
            new Error(
              "Каталог: в кадре обнаружен человек (лицо или фигура). Загрузите фото только товара без модели."
            )
          );
        }

        resolve();
      }
    );
  });
}

module.exports = { assertCatalogNoHuman };
