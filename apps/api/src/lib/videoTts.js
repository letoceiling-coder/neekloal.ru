"use strict";

const { spawn } = require("child_process");
const fs = require("fs");

/**
 * TTS → MP3. Пробует: VIDEO_TTS_COMMAND (полная команда с {out}) или python edge_tts.
 */
async function textToSpeechMp3(text, outPath) {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) return false;

  const custom = process.env.VIDEO_TTS_COMMAND;
  if (custom) {
    const cmd = custom.replace(/\{out\}/g, outPath).replace(/\{text\}/g, raw);
    await new Promise((resolve, reject) => {
      const child = spawn("/bin/sh", ["-c", cmd], { stdio: "inherit" });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`TTS exit ${code}`))));
    });
    return fs.existsSync(outPath);
  }

  const py = process.env.VIDEO_TTS_PYTHON || "python3";
  const args = ["-m", "edge_tts", "--text", raw, "--write-media", outPath];
  await new Promise((resolve, reject) => {
    const child = spawn(py, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && fs.existsSync(outPath)) resolve();
      else reject(new Error(`edge_tts failed: ${err.slice(-500)}`));
    });
  });
  return true;
}

module.exports = { textToSpeechMp3 };
