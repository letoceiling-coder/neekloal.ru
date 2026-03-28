# AI PLATFORM — DEPLOYMENT RULES (STRICT / SSOT)

⚠️ **ЭТО ЕДИНСТВЕННЫЙ ИСТОЧНИК ПРАВДЫ ДЛЯ ДЕПЛОЯ**  
⚠️ **ЛЮБОЕ ОТКЛОНЕНИЕ = ОШИБКА**  
⚠️ **СНАЧАЛА АУДИТ → ПОТОМ ДЕЙСТВИЯ**

---

## 0. Главное правило

👉 **СЕРВЕР = ИСТИНА**  
👉 **GIT = ИСТИНА**  
👉 **ДОКУМЕНТ = ИСТИНА**

Если они не совпадают →  
❗ **СНАЧАЛА СИНХРОНИЗАЦИЯ**  
❗ **ПОТОМ ДЕЙСТВИЯ**

---

## 1. Servers

### MAIN SERVER (PRODUCTION)

| | |
|--|--|
| **IP** | `89.169.39.244` |

**ACCESS:**

```bash
ssh root@89.169.39.244
```

**ROLE:**

- API  
- Nginx  
- PM2  

### GPU SERVER (OLLAMA)

| | |
|--|--|
| **IP** | `188.124.55.89` |
| **PORT** | `11434` |

**ROLE:**

- LLM inference  

---

## 2. Project root (единственный)

```
/var/www/site-al.ru
```

❗ **ДРУГИХ КОРНЕЙ ДЛЯ ЭТОГО ПРОЕКТА НЕ СУЩЕСТВУЕТ**

### Структура

```
/var/www/site-al.ru/
  apps/
    api/
    widget/
    web/
  packages/
  infra/
  docs/
```

### Запрещённые пути

**НЕ ИСПОЛЬЗОВАТЬ:**

- `/var/www/neekloal-repo`  
- `/var/www/ai-platform`  

❗ **ЭТО НЕ ЭТОТ ПРОЕКТ**  
❗ **НЕ ДЕПЛОИТЬ ТУДА**  
❗ **НЕ ЗАПУСКАТЬ ОТТУДА**  

---

## 3. Domain

**`site-al.ru`**

### Реальное поведение

| URL | Действие |
|-----|----------|
| `/api/*` | → `127.0.0.1:4000` |
| `/widget.js` | файл с диска |
| `/` | `return 200` |

---

## 4. Nginx

**CONFIG:**

`/etc/nginx/sites-enabled/site-al.ru`

### Логика

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:4000/;
}

location = /widget.js {
    alias /var/www/site-al.ru/apps/widget/widget.js;
}

location / {
    return 200 "AI PLATFORM site-al.ru WORKING";
}
```

### Запрещено

- менять другие сайты  
- трогать `default_server`  
- удалять SSL-сертификаты  

---

## 5. PM2

| | |
|--|--|
| **PROCESS** | `ai-api` |
| **cwd** | `/var/www/site-al.ru/apps/api` |
| **script** | `src/app.js` |

### Запуск

```bash
cd /var/www/site-al.ru/apps/api
pm2 start src/app.js --name ai-api
pm2 save
```

---

## 6. Ollama

```
http://188.124.55.89:11434
```

**ENV:**

```env
OLLAMA_URL=http://188.124.55.89:11434
```

---

## 7. Deploy (единственный сценарий)

```bash
ssh root@89.169.39.244

cd /var/www/site-al.ru

git pull origin main

cd apps/api
npm ci

pm2 restart ai-api
pm2 save
```

### Строго запрещено

❌ `cp`  
❌ `rsync`  
❌ ручное копирование  
❌ запуск с другого пути  
❌ создание новых директорий  

---

## 8. Проверка (обязательно)

### API

```bash
curl -sS https://site-al.ru/api/health
```

**Ожидание:**

```json
{"status":"ok"}
```

### PM2

```bash
pm2 describe ai-api
```

**Ожидание:**

`cwd` = `/var/www/site-al.ru/apps/api`

### PORT

```bash
ss -tulnp | grep 4000
```

**Ожидание:**

`LISTEN` `0.0.0.0:4000`

### NGINX

```bash
nginx -t
```

**Ожидание:**

- `syntax is ok`  
- `test is successful`  

---

## 9. Git sync

```bash
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
```

**Ожидание:**

👉 **одинаковые хэши**

---

## 10. Анти-хаос

**Если:**

- другой путь  
- другой домен  
- другой cwd  
- другой порт  

👉 **ЭТО ОШИБКА**

---

## 11. Critical rule

**НИКОГДА:**

❌ не угадывать  
❌ не «примерно»  
❌ не «вроде работает»  

**ТОЛЬКО:**

✔ проверка  
✔ факты  
✔ команды  

---

## 12. Cursor rule

**CURSOR обязан:**

**Сначала:** проверить сервер, показать факты  
**Потом:** предложить действия  
**После:** дать доказательства  

---

## Final

👉 У нас **один** проект  
👉 **один** сервер  
👉 **одна** директория  

Всё остальное — мусор.
