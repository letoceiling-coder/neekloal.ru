"use strict";

const { spawn } = require("child_process");
const fs = require("fs");

/**
 * Edge TTS → audio file (MP3). Uses `edge-tts` CLI if on PATH, else `python3 -m edge_tts`.
 */
async function generateTTS({ text, output }) {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) {
    return Promise.reject(new Error("TTS: empty text"));
  }

  const tryCli = (cmd, args) =>
    new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
      let err = "";
      proc.stderr.on("data", (d) => {
        err += d.toString();
      });
      proc.stdout.on("data", (d) => {
        process.stdout.write(`[TTS] ${d.toString()}`);
      });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0 && fs.existsSync(output)) resolve(output);
        else reject(new Error(`TTS failed (${cmd} exit ${code}): ${err.slice(-800)}`));
      });
    });

  const binary = process.env.VIDEO_TTS_BINARY || "edge-tts";
  try {
    await tryCli(binary, ["--text", raw, "--write-media", output]);
    return output;
  } catch (e) {
    const py = process.env.VIDEO_TTS_PYTHON || "python3";
    await tryCli(py, ["-m", "edge_tts", "--text", raw, "--write-media", output]);
    return output;
  }
}

module.exports = { generateTTS };
