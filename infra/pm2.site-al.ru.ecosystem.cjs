/**
 * PM2 для production site-al.ru
 * На сервере:
 *   pm2 start /var/www/site-al.ru/infra/pm2.site-al.ru.ecosystem.cjs
 * или скопировать ecosystem в /var/www/site-al.ru/
 */
module.exports = {
  apps: [
    {
      name: "ai-api",
      cwd: "/var/www/site-al.ru/apps/api",
      script: "server.js",
      instances: 1,
      autorestart: true,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "deploy-webhook",
      cwd: "/var/www/site-al.ru",
      script: "webhook.js",
      instances: 1,
      autorestart: true,
      max_memory_restart: "200M",
      env: {
        NODE_ENV: "production",
        DEPLOY_WEBHOOK_PORT: "9001",
        DEPLOY_WEBHOOK_HOST: "127.0.0.1",
        DEPLOY_SCRIPT_PATH: "/var/www/site-al.ru/deploy.sh",
      },
    },
  ],
};
