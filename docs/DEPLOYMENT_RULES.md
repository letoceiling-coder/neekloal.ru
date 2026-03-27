# Deployment & infrastructure — single source of truth

Документ задаёт **проверенные** правила для production: сервер, пути, домены, nginx, PM2, деплой, проверки.  
Если факт на сервере расходится с этим файлом — **сначала обновить документ фактами**, потом действовать.

---

## 1. Servers

### MAIN SERVER

| Field | Value |
|--------|--------|
| **IP** | `89.169.39.244` |
| **Role** | production (AI platform) |
| **Access** | `ssh root@89.169.39.244` |

### GPU SERVER (Ollama)

| Field | Value |
|--------|--------|
| **IP** | `188.124.55.89` |
| **Role** | Ollama / LLM |
| **Port** | `11434` |

---

## 2. Project structure (единая)

**Единственный корень кода этого репозитория на MAIN SERVER:**

```
/var/www/site-al.ru
```

### Внутри

| Path | Назначение |
|------|------------|
| `/var/www/site-al.ru/apps/api` | Backend (Fastify) |
| `/var/www/site-al.ru/apps/widget` | Widget |
| `/var/www/site-al.ru/apps/web` | Frontend (планируется) |
| `/var/www/site-al.ru/packages` | Shared packages |
| `/var/www/site-al.ru/infra` | Шаблоны/референсы конфигов |
| `/var/www/site-al.ru/docs` | Документация |

### Запрещено для этого проекта

Не использовать как целевой путь деплоя **`ai-api` / репозитория site-al.ru:**

- `/var/www/neekloal-repo` — legacy, не использовать.
- `/var/www/ai-platform` — не этот проект; на хосте могут быть другие сервисы, **не** смешивать с деплоем `site-al.ru`.

---

## 3. Domains

### `site-al.ru`

**Назначение:** основной домен платформы.

| Route | Поведение (факт из nginx) |
|-------|---------------------------|
| `/api/*` | Reverse proxy → backend `http://127.0.0.1:4000/` |
| `/widget.js` | Файл с диска: `/var/www/site-al.ru/apps/widget/widget.js` |
| `/` | Временная заглушка: `return 200 "AI PLATFORM site-al.ru WORKING"` |

---

## 4. Nginx

**Активный конфиг vhost:**

```
/etc/nginx/sites-enabled/site-al.ru
```

### Логика (как в конфиге)

```nginx
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
```

### Ограничения

- Не менять **другие** vhost без необходимости.
- Не трогать **`default_server`** и файлы вроде `00-default-443-reject.conf` без отдельной задачи.
- SSL: правки только осознанно (Certbot / существующие `ssl_certificate`).

---

## 5. PM2

| Field | Value |
|--------|--------|
| **Process name** | `ai-api` |
| **Working directory** | `/var/www/site-al.ru/apps/api` |
| **Entry** | `src/app.js` (из этого cwd) |

**Пример запуска с нуля (из каталога api):**

```bash
cd /var/www/site-al.ru/apps/api
pm2 start src/app.js --name ai-api
```

После изменений процесса: `pm2 save` по политике сервера.

---

## 6. Ollama (GPU)

**Base URL (в конфиге API):**

```
http://188.124.55.89:11434
```

(Точное имя переменной окружения — в `apps/api`, например `OLLAMA_URL`.)

---

## 7. Deploy rules

**Порядок на MAIN SERVER после обновления кода:**

1. `cd /var/www/site-al.ru`
2. `git pull` (ветка `main`, без расхождений с `origin`)
3. `cd apps/api && npm ci` или `npm install` (как принято в репозитории)
4. `pm2 restart ai-api`
5. **Nginx не трогать** без причины (после правок — `nginx -t` и только `reload`).

### Запрещено

- Деплой через `cp` / `rsync` вместо git для этого репозитория.
- Создавать произвольные каталоги вне описанной структуры под этот продукт.
- Менять **cwd** у `ai-api` на другой путь.
- Запускать backend с другого дерева, чем `/var/www/site-al.ru/apps/api`.

---

## 8. Verification (после каждого деплоя)

```bash
curl -sS https://site-al.ru/api/health
```

**Ожидание:** JSON с `"status":"ok"` (и при необходимости поля `uptime`, `ollama`, и т.д.).

```bash
pm2 describe ai-api
```

**Ожидание:** `exec cwd` = `/var/www/site-al.ru/apps/api`.

```bash
nginx -t
```

**Ожидание:** `syntax is ok`, `test is successful`.

---

## 9. Single source of truth

- **Production:** фактическое состояние на MAIN SERVER и этот документ в актуальной версии в git.
- **Локальная машина:** только разработка; не считать её эталоном путей и процессов.

---

## 10. Anti-chaos rule

Если путь, домен или процесс **не совпадают** с этим документом — для деплоя **этого** проекта они **не используются**, пока документ и сервер не приведены к одному виду осознанно.
