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

/**
 * Download a remote image via native fetch (no axios dependency).
 * Returns a Buffer with the image bytes.
 */
async function downloadImage(imageUrl) {
  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${imageUrl}`);
  return Buffer.from(await res.arrayBuffer());
}

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
async function processImage(inputBuffer, originalName) {
  const id         = uuidv4();
  const tempInput  = path.join(os.tmpdir(), `rembg_in_${id}.png`);
  const tempOutput = path.join(os.tmpdir(), `rembg_out_${id}.png`);

  try {
    // Write input to temp file
    fs.writeFileSync(tempInput, inputBuffer);
    process.stdout.write(`[removeBg] input written: ${tempInput} (${inputBuffer.length} bytes)\n`);

    if (!fs.existsSync(tempInput)) {
      throw new Error(`[removeBg] temp input file not found after write: ${tempInput}`);
    }

    process.stdout.write(`[removeBg] processing ${originalName} (id=${id})\n`);
    await runRembg(tempInput, tempOutput);

    if (!fs.existsSync(tempOutput)) {
      throw new Error(`[removeBg] rembg produced no output file: ${tempOutput}`);
    }

    // Ensure output directory exists
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const savedName = `rembg_${id}.png`;
    const finalPath = path.join(OUTPUT_DIR, savedName);
    fs.copyFileSync(tempOutput, finalPath);

    if (!fs.existsSync(finalPath)) {
      throw new Error(`[removeBg] file not found after copy: ${finalPath}`);
    }

    const publicUrl = `${PUBLIC_BASE}/${savedName}`;
    process.stdout.write(`[removeBg] SAVED IMAGE: ${finalPath} → ${publicUrl}\n`);

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

      const originalName = path.basename(new URL(imageUrl).pathname) || "image.jpg";
      const buffer = await downloadImage(imageUrl);
      process.stdout.write(`[removeBg] downloaded ${buffer.length} bytes — ${originalName}\n`);

      // If imageUrl points to a local path, verify the file exists before processing
      if (imageUrl.includes("/uploads/")) {
        const localPath = path.join(
          "/var/www/site-al.ru",
          new URL(imageUrl).pathname,
        );
        if (!fs.existsSync(localPath)) {
          process.stderr.write(`[removeBg] source file not found on disk: ${localPath}\n`);
          return reply.code(404).send({ error: "FILE_NOT_FOUND", path: localPath });
        }
        process.stdout.write(`[removeBg] source file verified: ${localPath}\n`);
      }

      const result = await processImage(buffer, originalName);
      return reply.send(result);
    } catch (err) {
      process.stderr.write(`[removeBg] json route error: ${err.message}\n`);
      if (err.code === "ERR_OPERATION_TIMEOUT" || err.message.includes("timed out")) {
        return reply.code(504).send({ error: "Обработка заняла слишком долго." });
      }
      if (err.message.includes("FILE_NOT_FOUND")) {
        return reply.code(404).send({ error: "Изображение не найдено." });
      }
      return reply.code(500).send({ error: "Не удалось удалить фон.", detail: err.message });
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
