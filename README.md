# Map Image Generator API

Сервис рисует винтажные карты 1232×522 WebP (MapLibre GL Native + Sharp), кладёт файл на диск и отдаёт клиенту публичный URL. Повтор той же точки не рендерится — берётся кэш.

Один клиент. Точек может быть много, разово до ~2000. Рендер тяжёлый (секунды на картинку), параллелить почти нельзя.

Интерактивная спецификация: `/docs` (Swagger UI) и `/openapi.json`.

## Как это работает

```
JSON { lat, lon, place? }
  → Zod-валидация
  → кэш/резерв по округлённым координатам (4 знака) + renderVersion
  → сразу { url, status: pending|ready }
  → если файла нет: очередь (concurrency 1, ретраи) → MapLibre → тот же storage/{uuid}.webp
```

Сторонняя API пишет `url` в свою БД один раз. Пока файла нет, `GET url` даёт `404` (без кэша) — у себя показывают заглушку. Когда рендер закончился, тот же URL отдаёт WebP.

Батч резервирует URL на каждую точку сразу. Крупный батч рисуется внутри сервиса; клиенту достаточно сохранить `url` и поллить файл. Express только принимает и отдаёт JSON.

## Стек

| Слой | Выбор |
|---|---|
| HTTP | Express, `/api/v1` |
| Язык | TypeScript (strict, ESM) |
| Рендер | variant 2: `maplibre-gl-native` + `sharp` |
| БД | MongoDB + Prisma `6.19.x` (нужен replica set) |
| Файлы | диск `STORAGE_DIR/{uuid}.webp` |
| Доки | OpenAPI 3 + Swagger UI |
| Тесты | `node:test` + Supertest + in-memory Mongo |

Прод: Linux x64. Нативные бинарники не для Windows/ARM «на всякий случай» и не для serverless.

## Быстрый старт

Нужны Node 20+ и MongoDB replica set.

```bash
cp .env.example .env
docker compose up -d mongo mongo-init
npm install
npx prisma generate
npx prisma db push
npm run dev
```

Swagger: http://localhost:3000/docs или `npm run docs`.

Проверка:

```bash
curl -s http://localhost:3000/healthz
# {"status":"ok"}

curl -s -X POST http://localhost:3000/api/v1/maps \
  -H "content-type: application/json" \
  -d '{"lat":48.8566,"lon":2.3522,"place":"Paris"}'
```

Ответ новой точки — `201` и стабильный `url` (`status` обычно `pending`). Повтор той же точки — `200`. Если файл уже есть — `"cached": true` и `status: ready`. Картинку качать с `url`; пока её нет — `404`.

Авторизации нет: ручки открыты. Для `POST /api/v1/maps/batch` можно добавить `Idempotency-Key`. Повтор с тем же ключом и тем же телом вернёт тот же ответ. Если первый запрос ещё идёт — `409 IDEMPOTENCY_IN_PROGRESS`. Если тем же ключом ушло другое тело — `409 IDEMPOTENCY_KEY_REUSED`.

## API

### `POST /api/v1/maps`

Одна карта.

**Тело**

```json
{ "lat": 48.8566, "lon": 2.3522, "place": "Paris" }
```

| Поле | Тип | Ограничения |
|---|---|---|
| `lat` | number | −90…90, обязательно |
| `lon` | number | −180…180, обязательно |
| `place` | string | опционально, 1…200 символов |

Лишние поля запрещены.

**Ответ** `201` (новая резервация) или `200` (запись уже была)

```json
{
  "id": "665f1c2e9a1b2c3d4e5f6789",
  "url": "http://localhost:3000/storage/550e8400-e29b-41d4-a716-446655440000.webp",
  "lat": 48.8566,
  "lon": 2.3522,
  "place": "Paris",
  "cached": false,
  "status": "pending",
  "renderVersion": "v1"
}
```

`url` стабилен для `(lat, lon, renderVersion)`: его можно сразу писать в чужую БД. Рендер идёт в фоне в тот же файл. `status`: `pending` / `ready` / `failed`. Пока файла нет, `GET url` → `404` с `Cache-Control: no-store`. Когда файл появился — `200` и долгий immutable cache.

`place` при попадании в кэш не обновляется — остаётся первое сохранённое значение. Если рендер упал, сервис сам делает несколько попыток в тот же URL; после лимита `status: failed`. Повторный POST той же точки пробует снова, ссылка не меняется.

### `POST /api/v1/maps/batch`

Пачка точек. URL резервируется сразу на каждую точку, рендер в фоне. Одна битая точка не валит весь батч.

```json
{
  "items": [
    { "lat": 48.8566, "lon": 2.3522, "place": "Paris" },
    { "lat": 51.5074, "lon": -0.1278, "place": "London" }
  ]
}
```

Поведение зависит от размера:

| Размер | Ответ |
|---|---|
| 1…`SYNC_BATCH_LIMIT` (по умолчанию 50) | `200` + `items` с `url` |
| больше лимита, до `MAX_BATCH_ITEMS` (2000) | `202` + `jobId` + `items` с `url` |
| больше `MAX_BATCH_ITEMS` | `400 BATCH_TOO_LARGE` |

**Синхронный `200`**

```json
{
  "mode": "sync",
  "total": 2,
  "created": 2,
  "cached": 0,
  "failed": 0,
  "items": [
    {
      "ok": true,
      "index": 0,
      "id": "...",
      "url": "http://localhost:3000/storage/....webp",
      "lat": 48.8566,
      "lon": 2.3522,
      "place": "Paris",
      "cached": false,
      "status": "pending",
      "renderVersion": "v1"
    },
    {
      "ok": true,
      "index": 1,
      "id": "...",
      "url": "http://localhost:3000/storage/....webp",
      "status": "pending",
      "lat": 51.5074,
      "lon": -0.1278,
      "place": "London",
      "cached": false,
      "renderVersion": "v1"
    }
  ]
}
```

**Асинхронный `202`**

```json
{
  "mode": "async",
  "jobId": "665f1c2e9a1b2c3d4e5f6789",
  "total": 200,
  "status": "queued",
  "items": [
    {
      "ok": true,
      "index": 0,
      "id": "...",
      "url": "http://localhost:3000/storage/....webp",
      "status": "pending",
      "lat": 48.8566,
      "lon": 2.3522,
      "place": "Paris",
      "cached": false,
      "renderVersion": "v1"
    }
  ]
}
```

`items` уже содержат URL — их можно сразу сохранить. Крупный батч рисуется внутри сервиса; клиенту достаточно поллить сами `url`. Браузер для тысяч точек не подходит.

Если активных внутренних job уже `MAX_QUEUED_JOBS` — `429 TOO_MANY_JOBS`.

Картинки отдаются с `GET /storage/{uuid}.webp` (это не API-ручка, а файл по зарезервированному URL). Имя только UUID, кэш `immutable`. Не-UUID и пути вроде `.tmp/...` — `404`. Пока файла нет — `404` с `Cache-Control: no-store`.

### `GET /healthz` и `GET /readyz`

- `/healthz` — процесс жив.
- `/readyz` — Mongo и каталог storage доступны; иначе `503 NOT_READY`.

## Ошибки

Формат единый:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request body validation failed",
    "requestId": "..."
  }
}
```

Стек и пути диска в ответ не попадают. `requestId` дублируется в заголовке `x-request-id`.

| HTTP | code | Когда |
|---|---|---|
| 400 | `VALIDATION_ERROR` | тело не прошло Zod |
| 400 | `INVALID_COORDINATES` | широта/долгота вне диапазона (сервис) |
| 400 | `BATCH_TOO_LARGE` / `EMPTY_BATCH` | размер батча |
| 404 | `NOT_FOUND` | файла ещё нет или путь невалидный |
| 409 | `IDEMPOTENCY_IN_PROGRESS` | тот же ключ ещё обрабатывается |
| 409 | `IDEMPOTENCY_KEY_REUSED` | тот же ключ, другое тело |
| 429 | `TOO_MANY_JOBS` | слишком много активных внутренних job |
| 429 | `QUEUE_SATURATED` | очередь рендера полная (`MAX_RENDER_QUEUE`) |
| 500 | `RENDER_FAILED` | не удалось нарисовать |
| 502 | `TILE_PROVIDER_UNAVAILABLE` | style/тайлы недоступны |

## Кэш

Ключ: `(latKey, lonKey, renderVersion)` — **строки**, не float.

Координаты округляются до 4 знаков: `48.85661234` и `48.8566` — одна карта. Имя файла всегда UUID, не slug места.

Если запись в Mongo есть, а WebP на диске нет — рисуем заново **в тот же uuid**.

Смена визуала (стиль, overlay, размер): поднять `RENDER_VERSION`, иначе клиент продолжит получать старые картинки.

## Окружение

Шаблон: `.env.example`.

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `NODE_ENV` | `development` / `test` / `production` | `development` |
| `PORT` / `HOST` | listen | `3000` / `0.0.0.0` |
| `PUBLIC_BASE_URL` | префикс публичных URL картинок | обязателен |
| `DATABASE_URL` | Mongo, replica set | обязателен |
| `STORAGE_DIR` | каталог WebP | `./storage` |
| `RENDER_VERSION` | версия визуала в ключе кэша | `v1` |
| `RENDER_CONCURRENCY` | параллельных рендеров, 1–2 | `1` |
| `RENDER_MAX_ATTEMPTS` | попыток рендера в тот же URL | `3` |
| `RENDER_RETRY_BACKOFF_MS` | пауза между попытками, растёт с номером | `1000` |
| `SYNC_BATCH_LIMIT` | порог sync/async batch, до 100 | `50` |
| `MAX_BATCH_ITEMS` | жёсткий потолок батча | `2000` |
| `MAX_QUEUED_JOBS` | сколько внутренних job могут висеть активными | `10` |
| `MAX_RENDER_QUEUE` | глубина очереди рендера, дальше `429` | `50` |
| `ENABLE_DOCS` | `/docs` и `/openapi.json` | в prod по умолчанию `false` |
| `LOG_LEVEL` | pino | `info` |
| `TILE_FETCH_TIMEOUT_MS` | timeout style/тайлов | `15000` |
| `TILE_FETCH_RETRIES` | ретраи fetch | `2` |
| `CORS_ORIGIN` | CSV origin’ов; пусто — CORS выключен | пусто |

Mongo нужен replica set: Prisma использует транзакции на nested writes. Локально — `docker compose up -d mongo mongo-init`. Индексы дополнительно создаются при старте процесса.

## Docker

```bash
docker compose up --build
```

Поднимаются Mongo replica set, init и API. Картинки в volume `map_storage`.

Прод:

- образ Debian/Ubuntu x64, не Alpine «вслепую»;
- `ENABLE_DOCS=false`;
- свой `DATABASE_URL` (Atlas или replica set);
- персистентный диск под `STORAGE_DIR`;
- `PUBLIC_BASE_URL` — тот URL, который увидит клиент (схема + хост, без хвоста `/`).

## Скрипты

| Команда | Что делает |
|---|---|
| `npm run dev` | API с reload |
| `npm run build` / `npm start` | прод-сборка и запуск `dist` |
| `npm run typecheck` / `npm run lint` | TS и ESLint |
| `npm test` | unit + integration |
| `npm run test:coverage` | coverage unit (порог в `c8.config.json`) |
| `npm run docs` | открыть Swagger UI (`http://localhost:3000/docs`, API должен быть запущен) |
| `npm run openapi:validate` | проверка spec |
| `RUN_E2E_SMOKE=1 npm run test:e2e` | один реальный MapLibre-рендер |

Юнит и интеграция **не** ходят в MapLibre: рендер подменяется фейковым WebP. Integration поднимает in-memory Mongo replica set.

## Ограничения v1

- Один процесс API. Второй инстанс не предусмотрен: очередь в памяти.
- Тайлы сейчас с `demotiles.maplibre.org`. На 2000 карт провайдер может резать — для больших прогонов нужен свой стиль/кэш тайлов.
- ~2–8 с на картинку, 2000 точек ≈ 1–4 часа и порядка сотен МБ диска. Одним HTTP это не слать.
- Пользовательский MapLibre style, OAuth, GPU, картинки blob’ом в БД — не в v1.
- Prisma для Mongo без Migrate: схема через `prisma db push` + индексы на старте. Не обновлять Prisma до 7, пока нет Mongo connector.

## Клиенту

1. Для одной точки — `POST /api/v1/maps`, сразу сохранить `url`.
2. Для пачки — `POST /api/v1/maps/batch`, сохранить `items[].url`.
3. В UI — своя заглушка, пока `GET url` не станет `200`. URL не менять.
4. Повтор чанка безопасен: тот же URL + `Idempotency-Key` на batch.
