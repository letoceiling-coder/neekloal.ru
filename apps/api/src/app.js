"use strict";

require("dotenv").config();
const fastify = require("fastify");
const cors = require("@fastify/cors");

async function build() {
  const app = fastify({ logger: true });
  await app.register(cors);
  await app.register(require("./routes/health"));
  await app.register(require("./routes/users"));
  await app.register(require("./routes/apiKeys"));
  await app.register(require("./routes/assistants"));
  await app.register(require("./routes/knowledge"));
  await app.register(require("./routes/usage"));
  await app.register(require("./routes/chat"));
  return app;
}

const port = Number(process.env.PORT) || 4000;

build()
  .then((app) =>
    app.listen({ port, host: "0.0.0.0" }).then(() => {
      app.log.info(`listening on ${port}`);
    })
  )
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
