# Справочник: покрытие BCS Trade API в MCP

Документ фиксирует, какие HTTP/WS запросы покрыты MCP‑инструментами и куда складываются данные.

## 1) Авторизация
- **Refresh → Access token**
  - URL: `POST https://be.broker.ru/trade-api-keycloak/realms/tradeapi/protocol/openid-connect/token`
  - В MCP не вызывается вручную: токен обновляется автоматически внутри `bcs.*` и worker.
  - Настройки в `.env`: `BCS_REFRESH_TOKEN`, `BCS_CLIENT_ID`.

## 2) HTTP API → MCP инструменты

### Портфель и лимиты
- **Портфель** `GET /trade-api-bff-portfolio/api/v1/portfolio`
  - MCP: `bcs.portfolio.get`
  - Кэш: `bcs_private.holdings_snapshots`, `holdings_current`
- **Лимиты** `GET /trade-api-bff-limit/api/v1/limits`
  - MCP: `bcs.limits.get`
  - Кэш: `bcs_private.limits_snapshots`

### Заявки
- **Создать** `POST /trade-api-bff-operations/api/v1/orders`
  - MCP: `bcs.orders.create`
- **Отменить** `POST /trade-api-bff-operations/api/v1/orders/:id/cancel`
  - MCP: `bcs.orders.cancel`
- **Изменить** `POST /trade-api-bff-operations/api/v1/orders/:id`
  - MCP: `bcs.orders.replace`
- **Статус** `GET /trade-api-bff-operations/api/v1/orders/:id`
  - MCP: `bcs.orders.status`
- **Поиск** `POST /trade-api-bff-order-details/api/v1/orders/search`
  - MCP: `bcs.orders.search` (+ `store=true` для записи в БД)

### Сделки
- **Поиск** `POST /trade-api-bff-trade-details/api/v1/trades/search`
  - MCP: `bcs.trades.search` (+ `store=true`)

### Рыночные данные (HTTP)
- **Исторические свечи** `GET /trade-api-market-data-connector/api/v1/candles-chart`
  - MCP: `bcs.candles.get` / `bcs.candles.backfill`
  - Хранение: `bcs_market.candles`

### Справочник инструментов
- **По тикерам** `POST /trade-api-information-service/api/v1/instruments/by-tickers`
  - MCP: `bcs.instruments.by_tickers` (+ `store=true`)
- **По ISIN** `POST /trade-api-information-service/api/v1/instruments/by-isins`
  - MCP: `bcs.instruments.by_isins` (+ `store=true`)
- **По типу** `GET /trade-api-information-service/api/v1/instruments/by-type`
  - MCP: `bcs.instruments.by_type` (+ `store=true`)
- **Дисконты** `GET /trade-api-bff-marginal-indicators/api/v1/instruments-discounts`
  - MCP: `bcs.instruments.discounts` (+ кэш в `bcs_market.instrument_discounts`)

### Расписание торгов
- **Статус торгов** `GET /trade-api-information-service/api/v1/trading-schedule/status`
  - MCP: `bcs.trading.status` (+ кэш в `bcs_market.trading_status_snapshots`)
- **Расписание на день** `GET /trade-api-information-service/api/v1/trading-schedule/daily-schedule`
  - MCP: `bcs.trading.schedule` (+ кэш в `bcs_market.trading_schedule_snapshots`)

## 3) WebSocket API → таблицы БД

### Рыночные данные
- **Стакан** `wss://ws.broker.ru/trade-api-market-data-connector/api/v1/market-data/ws`
  - В БД: `bcs_market.order_book_snapshots`
- **Котировки** `.../market-data/ws` (dataType=3)
  - В БД: `bcs_market.quotes`
- **Последние сделки** `.../market-data/ws` (dataType=2)
  - В БД: `bcs_market.last_trades`
- **Последняя свеча** `.../market-data/ws` (dataType=1)
  - В БД: `bcs_market.candles`

### Портфель / Лимиты
- **Портфель WS** `wss://ws.broker.ru/trade-api-bff-portfolio/api/v1/portfolio/ws`
  - В БД: `bcs_private.holdings_snapshots`, `holdings_current`
- **Лимиты WS** `wss://ws.broker.ru/trade-api-bff-limit/api/v1/limits/ws`
  - В БД: `bcs_private.limits_snapshots`

### Заявки
- **Execution WS** `wss://ws.broker.ru/trade-api-bff-operations/api/v1/orders/execution/ws`
- **Transaction WS** `wss://ws.broker.ru/trade-api-bff-operations/api/v1/orders/transaction/ws`
  - В БД: `bcs_private.order_events`

### Маржинальные показатели
- **Marginal WS** `wss://ws.broker.ru/trade-api-bff-marginal-indicators/api/v1/marginal-indicators/ws`
  - В БД: `bcs_private.marginal_indicators_snapshots`

## 4) Сигналы и минимизация контекста

- `signals.run`:
  - читает свечи + последний стакан из БД,
  - вычисляет признаки и вероятности режимов,
  - записывает в `bcs_private.signal_features` и `signal_probs`.

Используйте `market.compute` / `private.aggregate` чтобы отдавать LLM компактные числа, а не большие массивы.
