# Production template: site-al.ru
# Скопировать в /etc/nginx/sites-available/ и включить sites-enabled.
# Проверка: sudo nginx -t && sudo systemctl reload nginx
#
# SSL: обычно отдельный server { listen 443 ssl; ... } — не ломайте существующий certbot.

server {
    listen 80;
    server_name site-al.ru;

    root /var/www/site-al.ru/apps/web/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # GitHub webhook → локальный Express (deploy-webhook, PM2)
    location /deploy {
        proxy_pass http://127.0.0.1:9001/deploy;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /widget.js {
        alias /var/www/site-al.ru/apps/widget/widget.js;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
