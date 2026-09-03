-- OAuth2 session handoff: opaque one-time exchange codes.
-- The real session token stays server-side in D1; only the short-lived
-- exchange code is sent to the GitHub Pages frontend.

CREATE TABLE IF NOT EXISTS oauth_exchange_codes (
  code_hash TEXT PRIMARY KEY,
  session_value TEXT NOT NULL,
  next_path TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_exchange_codes_expires
  ON oauth_exchange_codes(expires_at);

CREATE INDEX IF NOT EXISTS idx_oauth_exchange_codes_used
  ON oauth_exchange_codes(used_at);
