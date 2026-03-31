"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const authMiddleware = require("../middleware/auth");

const OUTPUT_DIR    = process.env.IMAGE_OUTPUT_DIR  || "/var/www/site-al.ru/uploads/images";
const PUBLIC_BASE   = process.env.IMAGE_PUBLIC_BASE || "https://site-al.ru/uploads/images";
const PYTHON_BIN    = process.env.PYTHON_BIN        || "python3";
const SCRIPT_PATH   = path.join(__dirname, "../scripts/rembg_worker.py");
const REMBG_TIMEOUT = Number(process.env.REMBG_TIMEOUT_MS) || 90_000;

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
          process.stderr.write(`[removeBg] python error: ${detail}\n`);
          return reject(new Error(`Background removal failed: ${detail.slice(0, 200)}`));
        }

        if (out.startsWith("OK:")) {
          process.stdout.write(`[removeBg] done → ${out.slice(3)}\n`);
          return resolve(out.slice(3));
        }

        process.stderr.write(`[removeBg] unexpected output: stdout="${out}" stderr="${err}"\n`);
        reject(new Error("Background removal returned unexpected result"));
      }
    );
  });
}

/** Core handler shared between JSON and multipart routes. */
async function processImage(inputBuffer, originalName, reply) {
  const id         = uuidv4();
  const tempInput  = path.join(os.tmpdir(), `rembg_in_${id}.png`);
  const tempOutput = path.join(os.tmpdir(), `rembg_out_${id}.png`);

  try {
    fs.writeFileSync(tempInput, inputBuffer);
    process.stdout.write(`[removeBg] processing ${originalName} (id=${id})\n`);

    await runRembg(tempInput, tempOutput);

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const savedName = `rembg_${id}.png`;
    const finalPath = path.join(OUTPUT_DIR, savedName);
    fs.copyFileSync(tempOutput, finalPath);
    const publicUrl = `${PUBLIC_BASE}/${savedName}`;
    process.stdout.write(`[removeBg] saved → ${finalPath}\n`);

    return { url: publicUrl, transparent: true, originalName, id };
  } finally {
    for (const f of [tempInput, tempOutput]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
    }
  }
}

module.exports = async function removeBgRoutes(fastify) {
  // ── JSON route (imageUrl) ────────────────────────────────────────────────
  fastify.post("/image/remove-bg", {
    preHandler: [authMiddleware],
    schema: {
      body: {
        type: "object",
        required: ["imageUrl"],
        properties: { imageUrl: { type: "string" } },
      },
    },
  }, async (request, reply) => {
    const { imageUrl } = request.body;
    try {
      process.stdout.write(`[removeBg] downloading ${imageUrl}\n`);
      const axios = require("axios");
      const res   = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 20_000 });
      const originalName = path.basename(new URL(imageUrl).pathname) || "image.jpg";

      const result = await processImage(Buffer.from(res.data), originalName, reply);
      return reply.send(result);
    } catch (err) {
      process.stderr.write(`[removeBg] json route error: ${err.message}\n`);
      if (err.message.includes("timed out")) {
        return reply.code(504).send({ error: "Обработка заняла слишком долго." });
      }
      return reply.code(500).send({ error: "Не удалось удалить фон." });
    }
  });

  // ── Multipart route (file upload) ────────────────────────────────────────
  // Uses a scoped sub-plugin so multipart registration doesn't affect JSON routes above
  await fastify.register(async function (scope) {
    await scope.register(require("@fastify/multipart"), {
      limits: { fileSize: 30 * 1024 * 1024, files: 1 },
    });

    scope.post("/image/remove-bg/upload", { preHandler: [authMiddleware] }, async (request, reply) => {
      try {
        const file = await request.file();
        if (!file) return reply.code(400).send({ error: "No file provided" });

        const ext = path.extname(file.filename).toLowerCase();
        if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) {
          return reply.code(400).send({ error: "Unsupported format. Use PNG, JPG, WEBP." });
        }

        const buffer = await file.toBuffer();
        const result = await processImage(buffer, file.filename, reply);
        return reply.send(result);
      } catch (err) {
        process.stderr.write(`[removeBg] upload route error: ${err.message}\n`);
        if (err.message.includes("timed out")) {
          return reply.code(504).send({ error: "Обработка заняла слишком долго." });
        }
        return reply.code(500).send({ error: "Не удалось удалить фон." });
      }
    });
  });
};
