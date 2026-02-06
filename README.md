# BCS MCP

Автономный MCP‑сервис для работы с **BCS Trade API**. Предназначен для подключения LLM (любой «нейронки») через MCP и даёт:

- сбор и хранение рыночных данных (котировки, стакан, обезличенные сделки, свечи);
- историю и аналитику личных действий (заявки, сделки, PnL, решения модели);
- потоковые данные по лимитам и маржинальным показателям;
- семантический поиск по истории через эмбеддинги Ollama;
- набор быстрых математических скриптов;
- простой деплой (2–3 действия) и понятные MCP‑инструменты.

Архитектура внутри контейнера:
- **Node.js MCP‑сервер** (tools + HTTP endpoints);
- **Python worker** (сбор данных, записи в БД, эмбеддинги).

База данных отдельная, разнесена логически:
- `bcs_market` — рыночные данные (статичные/внешние);
- `bcs_private` — личные действия (портфель, заявки, сделки, решения модели).

---

## Быстрый старт (автономно)

```bash
cd bcs-mcp
cp .env.example .env
# 1) вставьте BCS_REFRESH_TOKEN
# 2) при необходимости поменяйте BCS_CLIENT_ID (trade-api-read / trade-api-write)

docker compose -f compose.yml up -d
```

По умолчанию `.env.example` настроен под docker compose (`BCS_DB_HOST=bcsdb`).

Проверка:
```bash
curl http://127.0.0.1:3332/health
curl http://127.0.0.1:3332/tools
```

MCP по умолчанию работает через **stdio** (MCP_TRANSPORT=stdio). Для большинства MCP‑клиентов это стандартный режим.

---

## Настройка токена BCS

1. В веб‑версии БКС Мир инвестиций выпустите **refresh‑token**.
2. В `.env` укажите:
   - `BCS_REFRESH_TOKEN=...`
   - `BCS_CLIENT_ID=trade-api-read` (или `trade-api-write` для торговых операций)
3. Для разрешения **операций торговли** включите:
   - `BCS_ALLOW_WRITE=1`

---

## MCP‑инструменты (основные)

### Чтение данных из БД
- `market.fetch` — выборка из `bcs_market` по диапазону дат и фильтрам.
- `private.fetch` — выборка из `bcs_private` (портфель, сделки, PnL, решения).
- `market.latest` / `private.latest` — последний срез с проверкой актуальности.
- `market.aggregate` / `private.aggregate` — агрегаты по бакетам (min/max/avg/sum/count).
- `market.compute` — вычисления на стороне сервера (значения не уходят в LLM).
- `market.snapshot` — компактный рыночный срез (котировка + трейд + топ стакана).

### Watchlist
- `selected_assets.list`
- `selected_assets.upsert`

### Логи решений и эмбеддинги
- `decision.log` — сохранить решение модели; опционально — добавить в очередь эмбеддингов.
- `embedding.enqueue`
- `embedding.search` — семантический поиск по истории.
- `policy.get` / `policy.compact` / `policy.section` — торговые правила, комиссии, окна, ограничения.

### Скрипты
- `scripts.list`
- `scripts.run` — быстрые математические расчёты (SMA/EMA/RSI и т. д.)
  - `fee_estimate` — оценка комиссий по диапазону
  - `session_status` — определение торговой сессии и риска (MSK)
  - `forts_fee_estimate` — комиссия FORTS за контракт
  - `fx_storage_cost` — стоимость хранения валюты
- `scripts.catalog` — короткий список скриптов по категории/стратегии
- `signals.run` — компактные вероятности режимов/направления по свечам + стакану (с записью в БД)

### BCS REST (прямые вызовы)
- `bcs.portfolio.get`, `bcs.limits.get`
- `bcs.orders.create`, `bcs.orders.cancel`, `bcs.orders.replace`, `bcs.orders.status`
- `bcs.orders.search`, `bcs.trades.search`
- `bcs.candles.get`, `bcs.candles.backfill`
- `bcs.instruments.by_tickers`, `bcs.instruments.by_isins`, `bcs.instruments.by_type`
- `bcs.instruments.discounts`
- `bcs.trading.status`, `bcs.trading.schedule`

### Справочник (кэш в БД)
Инструменты `bcs.instruments.*` поддерживают параметр `store=true` — тогда ответ будет сохранён в `bcs_market.instruments`.

---

## Скрипты (математика)

Скрипты находятся в `scripts/`. Описание доступных скриптов — в `scripts/manifest.json`.

Пример вызова:
```json
{
  "name": "sma",
  "payload": { "values": [1,2,3,4,5], "period": 3 }
}
```

Добавление нового скрипта:
1. Создать `scripts/my_formula.py` с функцией `run(payload)`.
2. Добавить описание в `scripts/manifest.json`.

---

## Большие объёмы данных

- Таблицы `candles`, `quotes`, `order_book_snapshots`, `last_trades` партиционированы по времени.
- Для чтения больших периодов используйте `limit` + `offset` и диапазоны `range`.
- Для наполнения истории за годы используйте `bcs.candles.backfill` (или загрузку батчами через worker).

## Local‑first стратегия (меньше токенов)

- Всегда начинайте с `market.*` / `private.*` — это чтение из локальной БД.
- `bcs.*` используйте только если данных нет или нужна максимальная свежесть.
- Для расчётов над большими рядами используйте `market.compute` и `market.aggregate` — в LLM уйдёт только компактный результат.
  - `market.compute` поддерживает `fields[]` (несколько колонок) и передаёт их в скрипт как `series`.

## Миграции (если база уже создана)

Если контейнер `bcsdb` запускался раньше, новые таблицы не создадутся автоматически.
Примените SQL вручную:
```
db/init/01_market.sql
db/init/02_private.sql
db/init/03_policy.sql
db/init/04_signals.sql
```

## Ограничения API (важное)

- При превышении лимитов сервер возвращает **429 Too Many Requests**.
- Для потоковых данных предпочтительнее **WebSocket**, а не частые HTTP‑запросы.
- Лимиты по соединениям/сообщениям зависят от сервиса, поэтому для массовой подписки используйте `selected_assets` и разумные batch‑размеры.

---

## Переменные окружения (ключевые)

- `BCS_REFRESH_TOKEN` — обязательный refresh‑token
- `BCS_CLIENT_ID` — `trade-api-read` / `trade-api-write`
- `BCS_ALLOW_WRITE` — разрешить торговые операции
- `BCS_SUBSCRIBE_INSTRUMENTS` — список инструментов для стримов (формат `TQBR:SBER,TQBR:GAZP`)
- `BCS_USE_DB_INSTRUMENTS` — если `1`, подписки берутся из `selected_assets`
- `BCS_STREAM_MARKET` / `BCS_STREAM_PORTFOLIO` / `BCS_STREAM_ORDERS`
- `BCS_STREAM_LIMITS` / `BCS_STREAM_MARGINAL`
- `OLLAMA_EMBED_MODEL` — модель эмбеддингов (по умолчанию `nomic-embed-text`)
- `LOG_LEVEL` — уровень логирования (`debug` для полного трейсинга)

## Debug‑режим

Чтобы видеть **все действия** в терминале (запросы, записи в БД, вызовы Ollama/BCS):  
установите `LOG_LEVEL=debug` и перезапустите контейнер.

## Примечания по рынку

- Для фьючерсов новый торговый день начинается после вечернего клиринга **в 19:05** — с этого момента параметр «Изменение цены за день» пересчитывается заново.

## Справочник покрытия API

Подробная карта запросов и соответствие MCP‑инструментов:
`docs/bcs_api_reference.md`

---

## Структура проекта

```
 bcs-mcp/
 ├─ server/          # MCP-сервер (Node.js)
 ├─ worker/          # Сбор данных + эмбеддинги (Python)
 ├─ scripts/         # Формулы и быстрые расчёты
 ├─ db/init/         # SQL-инициализация БД
 ├─ compose.yml      # автономный запуск
 └─ Dockerfile       # единый контейнер (server+worker)
```

---

## Безопасность

- Для торговых операций требуется `BCS_ALLOW_WRITE=1`.
- Для HTTP API можно поставить токен `MCP_HTTP_TOKEN`.

---

## Roadmap (ближайшее)

- Автоматическое создание партиций по времени.
- Полная загрузка истории по любому диапазону дат (батч‑импорт).
- Визуальные отчёты и auto‑evaluation по решениям модели.
