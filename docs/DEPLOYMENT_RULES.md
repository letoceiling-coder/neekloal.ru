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

### 🚨 PM2 HARD RULE

**Запрещено:**

❌ запускать `ai-api` не из `/var/www/site-al.ru/apps/api`  
❌ иметь **более одного** процесса `ai-api`  
❌ использовать `pm2 start` из **других** директорий  

**Проверка:**

```bash
pm2 list
```

**Ожидание:** в списке **ровно один** процесс с именем `ai-api`.

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

### Перед любым деплоем (обязательно)

Убедиться, что вы в корне проекта на сервере:

```bash
cd /var/www/site-al.ru
pwd
```

**Ожидание:** вывод строки:

```
/var/www/site-al.ru
```

Если `pwd` другой — **остановиться**, не выполнять `git pull` / `npm` / `pm2` до перехода в этот каталог.

---

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

### API (кратко)

```bash
curl -sS https://site-al.ru/api/health
```

**Ожидание:**

```json
{"status":"ok"}
```

### NGINX routing (API через прокси)

Чтобы исключить ситуацию «отдаётся HTML вместо API» (ошибка прокси / не тот vhost):

```bash
curl -v https://site-al.ru/api/health
```

**Ожидание:**

- HTTP **`200`**
- тело — **JSON** (например `content-type: application/json`)
- **не** HTML-страница ошибки nginx / не редирект на чужой контент

### Backend напрямую (без nginx)

Проверка процесса на `127.0.0.1:4000` **минуя** домен и vhost:

```bash
curl -sS http://127.0.0.1:4000/health
```

**Ожидание:**

- HTTP **`200`**
- тело — **JSON** с `"status":"ok"` (и прочие поля по факту API)

Если здесь ошибка, а через `https://site-al.ru/api/health` работает — искать проблему в **nginx** / **слушателе** на MAIN SERVER, не в DNS/домене.

### Виджет (alias)

```bash
curl -sS https://site-al.ru/widget.js | head -n 5
```

**Ожидание:** ответ — текст **JavaScript** (начало файла виджета), не 404 и не HTML-заглушка страницы. Проверяет, что `location = /widget.js` и `alias` на диске работают.

### PM2

```bash
pm2 describe ai-api
```

**Ожидание:**

`cwd` = `/var/www/site-al.ru/apps/api`

### PM2 VERIFY (cwd, жёстко)

Быстрая проверка поля рабочего каталога в выводе PM2:

```bash
pm2 describe ai-api | grep cwd
```

**Ожидание:**

- в строке присутствует путь **`/var/www/site-al.ru/apps/api`**  
- в выводе `pm2 describe` поле отображается как **`exec cwd`** (подстрока `cwd` попадает под `grep cwd`)

### PROCESS VERIFY

Подтвердить, что процесс Node с `app.js` реально запущен (дополнительно к PM2):

```bash
ps aux | grep node | grep app.js
```

**Ожидание:**

- есть строка с **`node`** и путём к скрипту, содержащим **`site-al.ru/apps/api`** и **`app.js`**
- на хосте с несколькими Node-проектами трактовать совместно с **`pm2 describe ai-api`**: путь должен совпадать с корнем API этого проекта

### PORT

```bash
ss -tulnp | grep 4000
```

**Ожидание:**

`LISTEN` `0.0.0.0:4000`

### NGINX DOMAIN VERIFY

Убедиться, что в **загруженной** конфигурации фигурирует нужный домен и vhost:

```bash
nginx -T 2>/dev/null | grep site-al.ru
```

**Ожидание:**

- есть строки с **`server_name site-al.ru`**
- в дампе виден путь к файлу, из которого подключён конфиг (например комментарий `# configuration file .../site-al.ru`)

### NGINX

```bash
nginx -t
```

**Ожидание:**

- `syntax is ok`  
- `test is successful`  

### OLLAMA VERIFY (GPU)

Проверка доступности API Ollama на GPU-сервере:

```bash
curl -sS http://188.124.55.89:11434/api/tags
```

**Ожидание:**

- HTTP **`200`**
- тело — **JSON** со списком моделей (ключ `"models"` или эквивалентная структура ответа Ollama `/api/tags`)

Выполнять с MAIN SERVER или с машины с сетевым доступом к `188.124.55.89:11434`. Таймаут или отказ соединения фиксировать как ошибку доступности Ollama; при проверке `https://site-al.ru/api/health` с полем `ollama` в ответе отсутствие связи с GPU отражается в этом поле.

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

---

## Вердикт проверки (чеклист)

| Критерий | Итог |
|----------|------|
| Cursor понял задачу | ✅ |
| Ничего не сломал | ✅ |
| Логику сохранил | ✅ |
| Ошибки исправил | ✅ |
| Структуру улучшил | ✅ |
