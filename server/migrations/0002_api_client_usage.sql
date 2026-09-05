CREATE TABLE IF NOT EXISTS api_client_usage (
  api_version TEXT NOT NULL,
  client_version TEXT NOT NULL,
  client_platform TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_count BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (api_version, client_version, client_platform)
);

CREATE INDEX IF NOT EXISTS idx_api_client_usage_last_seen
  ON api_client_usage (api_version, last_seen_at DESC);
