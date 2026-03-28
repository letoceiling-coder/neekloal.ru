server {
    listen 80;
    server_name site-al.ru;

    location /api/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_set_header Host $host;
    }

    location = /widget.js {
        alias /var/www/site-al.ru/apps/widget/widget.js;
    }

    location / {
        return 200 "AI PLATFORM site-al.ru WORKING";
    }
}
