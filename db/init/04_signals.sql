\connect bcs_private

CREATE TABLE IF NOT EXISTS signal_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  ticker TEXT NOT NULL,
  class_code TEXT NOT NULL,
  time_frame TEXT NOT NULL,
  lookback INTEGER NOT NULL,
  features JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS signal_features_ts_idx ON signal_features (ts DESC);
CREATE INDEX IF NOT EXISTS signal_features_ticker_idx ON signal_features (ticker, class_code, ts DESC);

CREATE TABLE IF NOT EXISTS signal_probs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  ticker TEXT NOT NULL,
  class_code TEXT NOT NULL,
  time_frame TEXT NOT NULL,
  model TEXT NOT NULL,
  probs JSONB NOT NULL,
  direction JSONB,
  features_id UUID
);
CREATE INDEX IF NOT EXISTS signal_probs_ts_idx ON signal_probs (ts DESC);
CREATE INDEX IF NOT EXISTS signal_probs_ticker_idx ON signal_probs (ticker, class_code, ts DESC);
