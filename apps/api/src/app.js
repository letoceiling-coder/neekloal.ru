"use strict";

require("dotenv").config();
const fastify = require("fastify");
const cors = require("@fastify/cors");
const { startWidgetFollowUpSweep } = require("./jobs/startWidgetFollowUp");

async function build() {
  const app = fastify({ logger: true });
  await app.register(cors, {
    origin: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Api-Key", "X-Widget-Client"],
  });
  await app.register(require("./routes/auth"));
  await app.register(require("./routes/health"));
  await app.register(require("./routes/users"));
  await app.register(require("./routes/apiKeys"));
  await app.register(require("./routes/assistants"));
  await app.register(require("./routes/conversations"));
  await app.register(require("./routes/agents"));
  await app.register(require("./routes/toolsHttp"));
  await app.register(require("./routes/knowledge"));
  await app.register(require("./routes/usage"));
  await app.register(require("./routes/billing"));
  await app.register(require("./routes/chat"));
  await app.register(require("./routes/widget"));
  await app.register(require("./routes/admin"), { prefix: "/admin" });
  return app;
}

const port = Number(process.env.PORT) || 4000;

build()
  .then((app) =>
    app.listen({ port, host: "0.0.0.0" }).then(() => {
      app.log.info(`listening on ${port}`);
      try {
        const tree = typeof app.printRoutes === "function" ? app.printRoutes() : "";
        if (tree) {
          app.log.info({ routes: tree }, "registered routes");
        }
      } catch (e) {
        app.log.warn({ err: e }, "printRoutes failed");
      }
      startWidgetFollowUpSweep(app.log);
    })
  )
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
