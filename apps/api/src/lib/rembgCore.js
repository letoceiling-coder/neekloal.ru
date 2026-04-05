"use strict";

/**
 * Shared rembg (Python worker) — used by removeBg routes and imageWorker catalog pipeline.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const SCRIPT_PATH = path.join(__dirname, "../scripts/rembg_worker.py");
const REMBG_TIMEOUT = Number(process.env.REMBG_TIMEOUT_MS) || 90_000;

function runRembgFile(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ORT_LOGGING_LEVEL: "3" };
    execFile(
      PYTHON_BIN,
      [SCRIPT_PATH, inputPath, outputPath],
      { timeout: REMBG_TIMEOUT, env },
      (error, stdout, stderr) => {
        const out = (stdout || "").trim();
        const err = (stderr || "").trim();
        if (error) {
          return reject(new Error(`Background removal failed: ${(err || error.message).slice(0, 200)}`));
        }
        if (out.startsWith("OK:")) return resolve();
        reject(new Error("Background removal returned unexpected result"));
      }
    );
  });
}

/**
 * @param {Buffer} inputBuffer
 * @returns {Promise<Buffer>} PNG with alpha
 */
async function removeBackgroundBuffer(inputBuffer) {
  const id = uuidv4();
  const tempInput = path.join(os.tmpdir(), `rembg_in_${id}.png`);
  const tempOutput = path.join(os.tmpdir(), `rembg_out_${id}.png`);
  try {
    fs.writeFileSync(tempInput, inputBuffer);
    await runRembgFile(tempInput, tempOutput);
    if (!fs.existsSync(tempOutput)) {
      throw new Error("rembg produced no output");
    }
    return fs.readFileSync(tempOutput);
  } finally {
    for (const f of [tempInput, tempOutput]) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch { /* ignore */ }
    }
  }
}

module.exports = { removeBackgroundBuffer, runRembgFile };
