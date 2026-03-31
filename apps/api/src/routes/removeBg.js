"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const authMiddleware = require("../middleware/auth");

const OUTPUT_DIR   = process.env.IMAGE_OUTPUT_DIR  || "/var/www/site-al.ru/uploads/images";
const PUBLIC_BASE  = process.env.IMAGE_PUBLIC_BASE || "https://site-al.ru/uploads/images";
const PYTHON_BIN   = process.env.PYTHON_BIN        || "python3";
const SCRIPT_PATH  = path.join(__dirname, "../scripts/rembg_worker.py");
const REMBG_TIMEOUT = Number(process.env.REMBG_TIMEOUT_MS) || 90_000; // 90s

/** Call the Python rembg worker as a subprocess. */
function runRembg(inputPath, outputPath) {
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
          const detail = err || error.message;
          // Log stderr for debugging; don't expose internals to client
          process.stderr.write(`[removeBg] python error: ${detail}\n`);
          return reject(new Error(`Background removal failed: ${detail.slice(0, 200)}`));
        }

        if (out.startsWith("OK:")) {
          process.stdout.write(`[removeBg] done → ${out.slice(3)}\n`);
          return resolve(out.slice(3)); // the output path
        }

        process.stderr.write(`[removeBg] unexpected output: stdout="${out}" stderr="${err}"\n`);
        reject(new Error("Background removal returned unexpected result"));
      }
    );
  });
}

module.exports = async function removeBgRoutes(fastify) {
  // Register multipart for this plugin scope
  await fastify.register(require("@fastify/multipart"), {
    limits: { fileSize: 30 * 1024 * 1024, files: 1 },
  });

  /**
   * POST /image/remove-bg
   *
   * Accepts either:
   *   a) multipart/form-data  — field "image" (file)
   *   b) application/json     — { "imageUrl": "https://..." }
   *
   * Returns:
   *   { url, transparent: true, originalName }
   */
  fastify.post("/image/remove-bg", { preHandler: [authMiddleware] }, async (request, reply) => {
    const id = uuidv4();
    const tempInput  = path.join(os.tmpdir(), `rembg_in_${id}.png`);
    const tempOutput = path.join(os.tmpdir(), `rembg_out_${id}.png`);
    let   originalName = "image.png";

    try {
      // ── 1. Get image bytes ───────────────────────────────────────────────
      const ct = request.headers["content-type"] || "";

      if (ct.includes("multipart/form-data")) {
        const file = await request.file();
        if (!file) return reply.code(400).send({ error: "No file provided" });

        const ext = path.extname(file.filename).toLowerCase();
        if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) {
          return reply.code(400).send({ error: "Unsupported format. Use PNG, JPG, WEBP." });
        }

        originalName = file.filename;
        const buffer = await file.toBuffer();
        fs.writeFileSync(tempInput, buffer);

      } else {
        // JSON path — imageUrl
        const { imageUrl } = request.body || {};
        if (!imageUrl || typeof imageUrl !== "string") {
          return reply.code(400).send({ error: "imageUrl is required (or upload a file via multipart)" });
        }

        process.stdout.write(`[removeBg] downloading ${imageUrl}\n`);
        const axios = require("axios");
        const res = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 20_000 });
        fs.writeFileSync(tempInput, Buffer.from(res.data));
        originalName = path.basename(new URL(imageUrl).pathname) || "image.png";
      }

      // ── 2. Run rembg ─────────────────────────────────────────────────────
      process.stdout.write(`[removeBg] processing ${originalName} (id=${id})\n`);
      await runRembg(tempInput, tempOutput);

      // ── 3. Move output to public dir ──────────────────────────────────────
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      const savedName = `rembg_${id}.png`;
      const finalPath = path.join(OUTPUT_DIR, savedName);
      fs.copyFileSync(tempOutput, finalPath);
      const publicUrl = `${PUBLIC_BASE}/${savedName}`;

      process.stdout.write(`[removeBg] saved → ${finalPath}\n`);

      // ── 4. Cleanup temp files ─────────────────────────────────────────────
      for (const f of [tempInput, tempOutput]) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
      }

      return reply.send({
        url: publicUrl,
        transparent: true,
        originalName,
        id,
      });

    } catch (err) {
      // Cleanup on error
      for (const f of [tempInput, tempOutput]) {
        try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
      }
      process.stderr.write(`[removeBg] error: ${err.message}\n`);

      if (err.message.includes("timed out")) {
        return reply.code(504).send({ error: "Обработка заняла слишком долго. Попробуйте меньшее изображение." });
      }
      return reply.code(500).send({ error: "Не удалось удалить фон. Попробуйте другое изображение." });
    }
  });
};
