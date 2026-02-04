\connect bcs_market

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Справочник инструментов
CREATE TABLE IF NOT EXISTS instruments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT NOT NULL,
  class_code TEXT NOT NULL,
  isin TEXT,
  instrument_type TEXT,
  display_name TEXT,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ticker, class_code)
);

-- Свечи
CREATE TABLE IF NOT EXISTS candles (
  ticker TEXT NOT NULL,
  class_code TEXT NOT NULL,
  time_frame TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  open NUMERIC,
  high NUMERIC,
  low NUMERIC,
  close NUMERIC,
  volume NUMERIC,
  data JSONB,
  PRIMARY KEY (ticker, class_code, time_frame, ts)
) PARTITION BY RANGE (ts);
CREATE TABLE IF NOT EXISTS candles_default PARTITION OF candles DEFAULT;
CREATE INDEX IF NOT EXISTS candles_ts_idx ON candles (ts DESC);

-- Котировки (лучшие цены, last, OHLC)
CREATE TABLE IF NOT EXISTS quotes (
  id BIGSERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  class_code TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  bid NUMERIC,
  offer NUMERIC,
  last NUMERIC,
  open NUMERIC,
  close NUMERIC,
  high NUMERIC,
  low NUMERIC,
  change NUMERIC,
  change_rate NUMERIC,
  currency TEXT,
  security_trading_status INTEGER,
  data JSONB
) PARTITION BY RANGE (ts);
CREATE TABLE IF NOT EXISTS quotes_default PARTITION OF quotes DEFAULT;
CREATE INDEX IF NOT EXISTS quotes_ticker_ts_idx ON quotes (ticker, class_code, ts DESC);

-- Стакан котировок (снимки)
CREATE TABLE IF NOT EXISTS order_book_snapshots (
  id BIGSERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  class_code TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  depth INTEGER,
  bid_volume NUMERIC,
  ask_volume NUMERIC,
  bids JSONB,
  asks JSONB,
  data JSONB
) PARTITION BY RANGE (ts);
CREATE TABLE IF NOT EXISTS order_book_snapshots_default PARTITION OF order_book_snapshots DEFAULT;
CREATE INDEX IF NOT EXISTS order_book_ticker_ts_idx ON order_book_snapshots (ticker, class_code, ts DESC);

-- Обезличенные сделки
CREATE TABLE IF NOT EXISTS last_trades (
  id BIGSERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  class_code TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  side TEXT,
  price NUMERIC,
  quantity NUMERIC,
  volume NUMERIC,
  data JSONB
) PARTITION BY RANGE (ts);
CREATE TABLE IF NOT EXISTS last_trades_default PARTITION OF last_trades DEFAULT;
CREATE INDEX IF NOT EXISTS last_trades_ticker_ts_idx ON last_trades (ticker, class_code, ts DESC);

-- Статусы торгов (снимки)
CREATE TABLE IF NOT EXISTS trading_status_snapshots (
  id BIGSERIAL PRIMARY KEY,
  class_code TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL
) PARTITION BY RANGE (ts);
CREATE TABLE IF NOT EXISTS trading_status_snapshots_default PARTITION OF trading_status_snapshots DEFAULT;
CREATE INDEX IF NOT EXISTS trading_status_ts_idx ON trading_status_snapshots (class_code, ts DESC);

-- Расписание торгов (снимки)
CREATE TABLE IF NOT EXISTS trading_schedule_snapshots (
  id BIGSERIAL PRIMARY KEY,
  class_code TEXT NOT NULL,
  ticker TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL
) PARTITION BY RANGE (ts);
CREATE TABLE IF NOT EXISTS trading_schedule_snapshots_default PARTITION OF trading_schedule_snapshots DEFAULT;
CREATE INDEX IF NOT EXISTS trading_schedule_ts_idx ON trading_schedule_snapshots (class_code, ticker, ts DESC);

-- Дисконты по инструментам (снимки)
CREATE TABLE IF NOT EXISTS instrument_discounts (
  id BIGSERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  discount_long NUMERIC,
  discount_short NUMERIC,
  data JSONB
) PARTITION BY RANGE (ts);
CREATE TABLE IF NOT EXISTS instrument_discounts_default PARTITION OF instrument_discounts DEFAULT;
CREATE INDEX IF NOT EXISTS instrument_discounts_ticker_ts_idx ON instrument_discounts (ticker, ts DESC);
