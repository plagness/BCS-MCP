\connect bcs_private

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- Список выбранных активов (watchlist)
CREATE TABLE IF NOT EXISTS selected_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT NOT NULL,
  class_code TEXT NOT NULL,
  instrument_type TEXT,
  currency TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ticker, class_code)
);

-- Запросы/решения модели
CREATE TABLE IF NOT EXISTS decision_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  model TEXT,
  prompt TEXT,
  response TEXT,
  metadata JSONB
);
CREATE INDEX IF NOT EXISTS decision_logs_ts_idx ON decision_logs (ts DESC);

-- Операции по кошельку
CREATE TABLE IF NOT EXISTS wallet_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts TIMESTAMPTZ NOT NULL,
  currency TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  op_type TEXT NOT NULL,
  details JSONB
) PARTITION BY RANGE (ts);
CREATE TABLE IF NOT EXISTS wallet_operations_default PARTITION OF wallet_operations DEFAULT;
CREATE INDEX IF NOT EXISTS wallet_ops_ts_idx ON wallet_operations (ts DESC);

-- Активы на руках (текущие)
CREATE TABLE IF NOT EXISTS holdings_current (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account TEXT,
  ticker TEXT NOT NULL,
  class_code TEXT NOT NULL,
  quantity NUMERIC,
  avg_price NUMERIC,
  currency TEXT,
  data JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account, ticker, class_code)
);

-- Снимки портфеля
CREATE TABLE IF NOT EXISTS holdings_snapshots (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  account TEXT,
  data JSONB
) PARTITION BY RANGE (ts);
CREATE TABLE IF NOT EXISTS holdings_snapshots_default PARTITION OF holdings_snapshots DEFAULT;
CREATE INDEX IF NOT EXISTS holdings_snapshots_ts_idx ON holdings_snapshots (ts DESC);

-- Заявки (REST/WS)
CREATE TABLE IF NOT EXISTS orders (
  original_client_order_id UUID PRIMARY KEY,
  client_order_id UUID,
  ticker TEXT,
  class_code TEXT,
  side TEXT,
  order_type TEXT,
  quantity NUMERIC,
  price NUMERIC,
  status TEXT,
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_ticker_idx ON orders (ticker, class_code);

-- События по заявкам (WS execution/transaction)
CREATE TABLE IF NOT EXISTS order_events (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  original_client_order_id UUID,
  client_order_id UUID,
  order_status TEXT,
  execution_type TEXT,
  ticker TEXT,
  class_code TEXT,
  data JSONB
) PARTITION BY RANGE (ts);
CREATE TABLE IF NOT EXISTS order_events_default PARTITION OF order_events DEFAULT;
CREATE INDEX IF NOT EXISTS order_events_ts_idx ON order_events (ts DESC);

-- Лимиты (WS)
CREATE TABLE IF NOT EXISTS limits_snapshots (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL
) PARTITION BY RANGE (ts);
CREATE TABLE IF NOT EXISTS limits_snapshots_default PARTITION OF limits_snapshots DEFAULT;
CREATE INDEX IF NOT EXISTS limits_snapshots_ts_idx ON limits_snapshots (ts DESC);

-- Маржинальные показатели (WS)
CREATE TABLE IF NOT EXISTS marginal_indicators_snapshots (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL
) PARTITION BY RANGE (ts);
CREATE TABLE IF NOT EXISTS marginal_indicators_snapshots_default PARTITION OF marginal_indicators_snapshots DEFAULT;
CREATE INDEX IF NOT EXISTS marginal_indicators_snapshots_ts_idx ON marginal_indicators_snapshots (ts DESC);

-- Сделки
CREATE TABLE IF NOT EXISTS trades (
  id BIGSERIAL PRIMARY KEY,
  execution_id TEXT,
  ts TIMESTAMPTZ NOT NULL,
  ticker TEXT,
  class_code TEXT,
  side TEXT,
  price NUMERIC,
  quantity NUMERIC,
  commission NUMERIC,
  data JSONB
) PARTITION BY RANGE (ts);
CREATE TABLE IF NOT EXISTS trades_default PARTITION OF trades DEFAULT;
CREATE INDEX IF NOT EXISTS trades_ts_idx ON trades (ts DESC);

-- PnL по дням
CREATE TABLE IF NOT EXISTS pnl_daily (
  day DATE PRIMARY KEY,
  realized NUMERIC,
  unrealized NUMERIC,
  total NUMERIC,
  currency TEXT,
  details JSONB
);

-- PnL события (плюсы/минусы)
CREATE TABLE IF NOT EXISTS pnl_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts TIMESTAMPTZ NOT NULL,
  pnl_value NUMERIC NOT NULL,
  currency TEXT,
  source TEXT,
  details JSONB
) PARTITION BY RANGE (ts);
CREATE TABLE IF NOT EXISTS pnl_events_default PARTITION OF pnl_events DEFAULT;
CREATE INDEX IF NOT EXISTS pnl_events_ts_idx ON pnl_events (ts DESC);

-- Ошибки/разборы
CREATE TABLE IF NOT EXISTS mistake_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  ticker TEXT,
  class_code TEXT,
  expected TEXT,
  actual TEXT,
  delta NUMERIC,
  notes TEXT,
  metadata JSONB
);
CREATE INDEX IF NOT EXISTS mistake_logs_ts_idx ON mistake_logs (ts DESC);

-- Очередь на эмбеддинги
CREATE TABLE IF NOT EXISTS embedding_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  text TEXT NOT NULL,
  metadata JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS embedding_queue_status_idx ON embedding_queue (status, created_at);

-- Эмбеддинги (pgvector)
CREATE TABLE IF NOT EXISTS embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  embedding vector(768) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Индекс для семантического поиска (создавать после наполнения)
-- CREATE INDEX embeddings_idx ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
