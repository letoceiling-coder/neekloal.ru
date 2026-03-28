# AI PLATFORM — DEPLOYMENT RULES (STRICT / SSOT)

⚠️ **ЭТО ЕДИНСТВЕННЫЙ ИСТОЧНИК ПРАВДЫ ДЛЯ ДЕПЛОЯ**  
⚠️ **ЛЮБОЕ ОТКЛОНЕНИЕ = ОШИБКА**  
⚠️ **СНАЧАЛА АУДИТ → ПОТОМ ДЕЙСТВИЯ**

---

## 0. Главное правило

👉 **СЕРВЕР = ИСТИНА**  
👉 **GIT = ИСТИНА**  
👉 **ДОКУМЕНТ = ИСТИНА**

Расхождение между сервером, git и документом → **остановиться**. **Синхронизация.** Действия только после синхронизации.

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

Корень проекта на MAIN SERVER:

```bash
cd /var/www/site-al.ru
pwd
```

**Ожидание:** строка вывода:

```
/var/www/site-al.ru
```

**Результат `pwd` ≠ `/var/www/site-al.ru`:** остановиться. Не выполнять `git pull` / `npm` / `pm2` до перехода в `/var/www/site-al.ru`.

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

### 🚨 Остановка при несоответствии

Любая команда ниже: результат **не** совпадает с блоком **Ожидание** → **остановиться**. Деплой **не** считать успешным. Устранить расхождение. Повторить проверки.

---

### NODE VERIFY

```bash
which node
```

**Ожидание:** одна строка — абсолютный путь к бинарнику `node` (типично `/usr/bin/node` на Ubuntu; иной абсолютный путь допустим). Пустой вывод или код возврата ошибки → **остановиться**. Цель: исключить отсутствие `node` в PATH / не тот runtime при деплое.

---

### API DOUBLE CHECK (критично)

```bash
curl -sS https://site-al.ru/api/health
curl -sS http://127.0.0.1:4000/health
```

**Ожидание:**

- оба ответа: HTTP **`200`**
- оба тела: **JSON**
- **одинаковая структура JSON:** совпадают ключи верхнего уровня (`status`, `uptime`, `timestamp`, `ollama` — по факту текущего ответа API)

Расхождение: `https://site-al.ru/api/health` — HTTP 200, `http://127.0.0.1:4000/health` — ошибка → искать причину в **nginx** / процессе на порту **4000** на MAIN SERVER, не в DNS.

---

### NGINX routing (прокси, не HTML)

```bash
curl -v https://site-al.ru/api/health
```

**Ожидание:**

- HTTP **`200`**
- заголовок ответа: `content-type` содержит **`application/json`**
- тело: **JSON**
- тело: **не** HTML

---

### Виджет (alias)

```bash
curl -sS https://site-al.ru/widget.js | head -n 5
```

**Ожидание:** текст **JavaScript** (начало файла виджета). **Не** HTTP 404. **Не** HTML-заглушка страницы. Подтверждает `location = /widget.js` и `alias`.

---

### PM2

```bash
pm2 describe ai-api
```

**Ожидание:** в блоке процесса указано **`exec cwd`** → `/var/www/site-al.ru/apps/api` (поле в выводе PM2 называется `exec cwd`).

---

### PM2 VERIFY (cwd, жёстко)

```bash
pm2 describe ai-api | grep cwd
```

**Ожидание:** в строке присутствует путь **`/var/www/site-al.ru/apps/api`**. Поле в полном выводе: **`exec cwd`**.

---

### PM2 PROCESS COUNT

```bash
pm2 list | grep ai-api | wc -l
```

**Ожидание:** число **`1`**.

---

### PROCESS VERIFY

```bash
ps aux | grep node | grep app.js
```

**Ожидание:** строка с **`node`** и путём, содержащим **`site-al.ru/apps/api`** и **`app.js`**. Несколько Node на хосте: сопоставить с **`pm2 describe ai-api`** — путь должен совпадать с API этого проекта.

---

### PORT

```bash
ss -tulnp | grep 4000
```

**Ожидание:**

- строка **`LISTEN`** содержит **`0.0.0.0:4000`** (альтернативная запись в `ss`: `*:4000` на `0.0.0.0`)
- **не** допускается сценарий, в котором для этого API зафиксирован **только** `127.0.0.1:4000` **без** прослушивания `0.0.0.0:4000` — по текущим правилам прод требуется **`0.0.0.0:4000`**

---

### NGINX ACTIVE CONFIG

```bash
ls -l /etc/nginx/sites-enabled/
```

**Ожидание:**

- в списке есть запись **`site-al.ru`** (файл или symlink)
- **нет** двух разных файлов с одним и тем же именем **`site-al.ru`** в этом каталоге (дубликат имени)

---

### NGINX DOMAIN VERIFY

```bash
nginx -T 2>/dev/null | grep site-al.ru
```

**Ожидание:**

- есть строки с **`server_name site-al.ru`**
- в дампе `nginx -T` есть комментарий `# configuration file` с путём к файлу, содержащему **`site-al.ru`**

---

### NGINX (syntax)

```bash
nginx -t
```

**Ожидание:**

- `syntax is ok`  
- `test is successful`  

---

### OLLAMA VERIFY (GPU)

```bash
curl -sS http://188.124.55.89:11434/api/tags
```

**Ожидание:**

- HTTP **`200`**
- тело: **JSON** со списком моделей (ответ Ollama `/api/tags`)

Команда: с MAIN SERVER или с машины с L3-доступом к `188.124.55.89:11434`. Таймаут / отказ TCP: фиксировать как недоступность Ollama. Поле `ollama` в `https://site-al.ru/api/health` отражает связность с GPU по факту ответа API.

---

## 9. Git

### Git sync (хэши)

```bash
cd /var/www/site-al.ru
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
```

**Ожидание:** вывод `git rev-parse HEAD` и `git rev-parse origin/main` — **одинаковая** hex-строка.

---

### GIT STATUS VERIFY

```bash
cd /var/www/site-al.ru
git status
```

**Ожидание:** строка **`nothing to commit, working tree clean`**. Изменений в отслеживаемых файлах нет.

---

## 10. Анти-хаос

**Ошибка — при любом из условий:**

- другой путь к корню проекта  
- другой домен / другой vhost для этого продукта  
- другой `cwd` у `ai-api`  
- другой порт / нет `0.0.0.0:4000` по правилам §8  

👉 **ЭТО ОШИБКА. Остановиться.**

---

## 11. Rules

### Critical rule

**НИКОГДА:**

❌ не угадывать  
❌ не «примерно»  
❌ не «вроде работает»  

**ТОЛЬКО:**

✔ проверка  
✔ факты  
✔ команды  

---

### Cursor rule

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
