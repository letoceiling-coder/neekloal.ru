# Автодеплой site-al.ru

Файлы в этом каталоге зеркалируют пути на **MAIN SERVER** (`/var/www/site-al.ru`).

## Установка на сервере (один раз)

1. Скопировать в корень проекта:
   - `deploy.sh` → `/var/www/site-al.ru/deploy.sh`
   - `webhook.js` → `/var/www/site-al.ru/webhook.js`
   - `package.json` → `/var/www/site-al.ru/package.json` (зависимости вебхука)

2. Установить зависимости вебхука и права:

   ```bash
   cd /var/www/site-al.ru
   npm install
   chmod +x deploy.sh
   ```

3. Пользователь, от которого крутится PM2, должен иметь `sudo` для `nginx -t` и `systemctl reload nginx` (или править `deploy.sh` под root/cron).

4. PM2 (из репозитория):

   ```bash
   pm2 start /var/www/site-al.ru/infra/pm2.site-al.ru.ecosystem.cjs
   pm2 save
   ```

5. Nginx: добавить/обновить конфиг из `infra/nginx/site-al.ru` (см. `root` и `location /deploy`).

6. Опционально: `DEPLOY_WEBHOOK_SECRET` в env PM2 для `deploy-webhook` и тот же секрет в GitHub webhook (header `Authorization: Bearer …` или query `?token=`).

## GitHub

Webhook URL: `https://site-al.ru/deploy`  
Content type: `application/json`  
Events: **push** (branch `main`).
