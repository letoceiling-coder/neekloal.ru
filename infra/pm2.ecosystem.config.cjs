/**
 * On server (Linux), from repo root or any path:
 *   pm2 start /var/www/ai-platform/infra/pm2.ecosystem.config.cjs
 * Or:
 *   cd /var/www/ai-platform/apps/api && pm2 start src/app.js --name ai-api
 */
module.exports = {
  apps: [
    {
      name: "ai-api",
      cwd: "/var/www/ai-platform/apps/api",
      script: "src/app.js",
      instances: 1,
      autorestart: true,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
