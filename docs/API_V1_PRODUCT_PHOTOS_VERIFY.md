# API v1 — проверка фото карточки товара

Маршрут для пакетной проверки изображений по названию, описанию и цвету товара. Используется **vision-модель Ollama** (см. переменную `VISION_MODEL` на API-сервере). Аутентификация такая же, как у `POST /api/v1/chat`: **`X-Api-Key: sk-…`** или JWT (панель).

---

## Эндпоинт

| Метод | URL |
|--------|-----|
| `POST` | `https://site-al.ru/api/v1/product-photos/verify` |

Базовый префикс совпадает с остальным v1 API (у вас может быть свой хост; путь всегда `/api/v1/product-photos/verify`).

---

## Заголовки

| Заголовок | Обязательно | Описание |
|-----------|-------------|----------|
| `Content-Type` | Да | `application/json` |
| `X-Api-Key` | Да* | Ключ `sk-…` организации |
| `Authorization` | Альтернатива | `Bearer <JWT>` из панели (для тестов) |

\* Для внешних интеграций — только `X-Api-Key` (не подставлять ключ в `Authorization: Bearer`).

Лимит запросов: как у остального v1 (например 60/мин на ключ), заголовки `X-RateLimit-*` при 429.

---

## Тело запроса (JSON)

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `productName` | string | **Да** | Наименование товара |
| `description` | string | Нет | Текст описания карточки |
| `color` | string | Нет | Заявленный цвет (как в карточке) |
| `photos` | array | **Да** | Список объектов с полем `url` (HTTPS-ссылка на изображение). Поле `active` во входе игнорируется — сервер всегда пересчитывает результат. |
| `options` | object | Нет | Доп. настройки (см. ниже) |

### Элемент `photos[]`

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `url` | string | **Да** | Прямая ссылка на файл изображения (`https://…`). Должен отдаваться `Content-Type: image/*`. |

### Объект `options`

| Поле | Тип | По умолчанию | Описание |
|------|-----|----------------|----------|
| `minConfidence` | number (0…1) | `0.55` (или из `PRODUCT_PHOTO_VERIFY_MIN_CONFIDENCE`) | Порог: `active: true` только если модель вернула `match: true` **и** `confidence >= minConfidence`. |
| `concurrency` | integer (1…6) | `3` | Сколько изображений обрабатывать параллельно. |
| `language` | `"ru"` \| `"en"` | `"ru"` | Язык формулировок в `issues`. |

### Пример запроса

```json
{
  "productName": "Платье летнее",
  "description": "Миди, хлопок, без рукавов",
  "color": "красный",
  "photos": [
    { "url": "https://cdn.example.com/items/1/a.jpg", "active": true },
    { "url": "https://cdn.example.com/items/1/b.jpg", "active": true }
  ],
  "options": {
    "minConfidence": 0.6,
    "language": "ru",
    "concurrency": 2
  }
}
```

---

## Успешный ответ (`200`)

JSON:

| Поле | Тип | Описание |
|------|-----|----------|
| `productName` | string | Эхо входа |
| `description` | string \| null | Эхо |
| `color` | string \| null | Эхо |
| `modelUsed` | string | Имя vision-модели Ollama |
| `minConfidence` | number | Итоговый порог |
| `photos` | array | Результат по каждому URL |

### Элемент `photos[]` в ответе

| Поле | Тип | Описание |
|------|-----|----------|
| `url` | string | Исходный URL |
| `active` | boolean | `true`, если кадр признан соответствующим карточке и уверенность не ниже порога |
| `match` | boolean | Сырой вывод модели «совпадает / не совпадает» |
| `confidence` | number | Уверенность 0…1 |
| `issues` | string[] | Замечания (например несовпадение цвета) |
| `error` | string | Только при сбое этапа: `missing_url`, `url_not_allowed`, `fetch_failed`, `vision_failed` |

### Пример ответа

```json
{
  "productName": "Платье летнее",
  "description": "Миди, хлопок, без рукавов",
  "color": "красный",
  "modelUsed": "llava:latest",
  "minConfidence": 0.6,
  "photos": [
    {
      "url": "https://cdn.example.com/items/1/a.jpg",
      "active": true,
      "match": true,
      "confidence": 0.82,
      "issues": []
    },
    {
      "url": "https://cdn.example.com/items/1/b.jpg",
      "active": false,
      "match": false,
      "confidence": 0.4,
      "issues": ["Цвет на фото не соответствует заявленному красному"]
    }
  ]
}
```

---

## Ошибки

| HTTP | Тело | Когда |
|------|------|--------|
| `400` | `{ "error": "…" }` | Нет `productName`, пустой `photos`, слишком много элементов |
| `401` | `{ "error": "…" }` | Нет/неверный ключ или JWT |
| `403` | `{ "error": "…" }` | Организация заблокирована и т.п. (как в chat auth) |
| `429` | `{ "error": "Too Many Requests", … }` | Превышен rate limit |
| `500` | `{ "error": "…" }` | Внутренняя ошибка |

---

## Переменные окружения (API / Ollama)

Задаются на сервере, где крутится Node API и доступен `OLLAMA_URL` к GPU.

| Переменная | Назначение |
|------------|------------|
| `OLLAMA_URL` | База Ollama (обязательно, как для чата) |
| `VISION_MODEL` | Модель с поддержкой изображений, например `llava:latest` или `llama3.2-vision` — должна быть `ollama pull …` на машине Ollama |
| `PRODUCT_PHOTO_VERIFY_MAX_ITEMS` | Макс. число URL за один запрос (по умолчанию 24) |
| `PRODUCT_PHOTO_VERIFY_MAX_BYTES` | Макс. размер одного файла (байты), по умолчанию 8 MiB |
| `PRODUCT_PHOTO_VERIFY_FETCH_MS` | Таймаут загрузки URL (мс), по умолчанию 15000 |
| `PRODUCT_PHOTO_VERIFY_CONCURRENCY` | Параллелизм по умолчанию (1…6), по умолчанию 3 |
| `PRODUCT_PHOTO_VERIFY_MIN_CONFIDENCE` | Дефолтный порог 0…1, по умолчанию 0.55 |
| `PRODUCT_PHOTO_VERIFY_ALLOW_HTTP` | `1` — разрешить `http://` (только для отладки) |
| `PRODUCT_PHOTO_VERIFY_DNS_CHECK` | `0` — не резолвить DNS для проверки на private IP (слабее по SSRF) |
| `PRODUCT_PHOTO_VERIFY_HOST_ALLOWLIST` | Список через запятую: если задан, разрешены только эти хосты или их поддомены (например `cdn.shop.ru,img.shop.ru`) |

---

## Пример `curl`

```bash
curl -sS -X POST "https://site-al.ru/api/v1/product-photos/verify" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: sk-ВАШ_КЛЮЧ" \
  -d '{
    "productName": "Кроссовки",
    "color": "чёрный",
    "photos": [
      { "url": "https://example.com/1.jpg" }
    ],
    "options": { "minConfidence": 0.55, "language": "ru" }
  }'
```

---

## Проверка работоспособности (операторам)

- Без заголовка `X-Api-Key` / JWT ответ будет **`401`**.
- Для полного прогона на сервере API (из каталога `apps/api`, с рабочим `.env`):  
  `node scripts/e2e-product-photos-verify-remote.js`  
  Скрипт создаёт временный ключ, вызывает `POST …/product-photos/verify` с публичным JPEG и удаляет ключ.
- Некоторые CDN (например Wikimedia) могут отвечать **`429`** с IP датацентра — для тестов используйте стабильный хост картинок (в скрипте по умолчанию `placehold.co`).

## Ограничения и качество

- Решение модели **вероятностное**: для критичных сценариев комбинируйте порог `minConfidence`, ручную модерацию спорных кейсов и тесты на своих данных.
- Сервер **скачивает** каждый URL сам: ссылки должны быть доступны с сервера API (не `localhost` клиента без туннеля).
- Для снижения риска SSRF используйте **HTTPS**, при необходимости **`PRODUCT_PHOTO_VERIFY_HOST_ALLOWLIST`**.

---

## Связь с агентом

Маршрут **не использует** `agentId`. Ключ по-прежнему ограничивает доступ организацией. Отдельный сценарий «чат с агентом» остаётся на `POST /api/v1/chat`.
