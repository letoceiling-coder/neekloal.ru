# Активный прод: /etc/nginx/sites-enabled/site-al.ru (Certbot SSL).
# SPA: root + try_files. После правок: nginx -t && systemctl reload nginx
#
# /api/ → backend :4000 с отрезанием префикса: запрос /api/admin/plans → upstream GET /admin/plans

server {
    server_name site-al.ru;

    location /api/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_connect_timeout 10s;
        proxy_send_timeout 60s;
        proxy_read_timeout 120s;
    }

    location = /widget.js {
        alias /var/www/site-al.ru/apps/widget/widget.js;
    }

    location / {
        root /var/www/site-al.ru/apps/web/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/site-al.ru/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/site-al.ru/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot

}
server {
    if ($host = site-al.ru) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    listen 80;
    server_name site-al.ru;
    return 404; # managed by Certbot


}
