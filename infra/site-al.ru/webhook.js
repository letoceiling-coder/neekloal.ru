"use strict";

/**
 * Разместить на сервере: /var/www/site-al.ru/webhook.js
 * cd /var/www/site-al.ru && npm install (в каталоге с package.json рядом с webhook.js)
 * Или скопировать весь каталог infra/site-al.ru → /var/www/site-al.ru/webhook-app/
 *
 * Слушает только localhost (прокси через nginx).
 */

const { execFile } = require("child_process");
const express = require("express");

const PORT = Number(process.env.DEPLOY_WEBHOOK_PORT || 9001);
const HOST = process.env.DEPLOY_WEBHOOK_HOST || "127.0.0.1";
const DEPLOY_SCRIPT =
  process.env.DEPLOY_SCRIPT_PATH || "/var/www/site-al.ru/deploy.sh";

const app = express();
app.use(express.json({ limit: "1mb" }));

function log(...args) {
  console.log(new Date().toISOString(), "[deploy-webhook]", ...args);
}

app.get("/deploy", (_req, res) => {
  res.status(405).type("text/plain").send("Method Not Allowed — use POST");
});

app.post("/deploy", (req, res) => {
  log("START DEPLOY", "request received", {
    ip: req.ip,
    ua: req.headers["user-agent"],
  });

  const secret = process.env.DEPLOY_WEBHOOK_SECRET;
  if (secret) {
    const bearerOk = req.headers.authorization === `Bearer ${secret}`;
    const queryOk = req.query.token === secret;
    if (!bearerOk && !queryOk) {
      log("reject: invalid or missing secret");
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
  }

  res.status(202).json({
    ok: true,
    message: "deploy started",
  });

  execFile(
    "bash",
    [DEPLOY_SCRIPT],
    {
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PATH: process.env.PATH },
    },
    (err, stdout, stderr) => {
      if (stdout) {
        log("deploy.sh stdout:\n", stdout);
      }
      if (stderr) {
        log("deploy.sh stderr:\n", stderr);
      }
      if (err) {
        log("DEPLOY FAILED", err.message);
        return;
      }
      log("DEPLOY DONE");
    }
  );
});

app.listen(PORT, HOST, () => {
  log(`listening http://${HOST}:${PORT} POST /deploy`);
});
