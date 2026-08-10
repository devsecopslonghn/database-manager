SET search_path TO schemaops, public;

ALTER TABLE targets ADD COLUMN IF NOT EXISTS connection_host TEXT;
ALTER TABLE targets ADD COLUMN IF NOT EXISTS connection_port INTEGER;
ALTER TABLE targets ADD COLUMN IF NOT EXISTS connection_username TEXT;
ALTER TABLE targets ADD COLUMN IF NOT EXISTS secret_backend TEXT NOT NULL DEFAULT 'kubernetes'
    CHECK (secret_backend IN ('kubernetes', 'vault', 'external-secrets'));
ALTER TABLE targets ADD COLUMN IF NOT EXISTS ssl_mode TEXT NOT NULL DEFAULT 'require'
    CHECK (ssl_mode IN ('disable', 'require', 'verify-ca', 'verify-full'));
ALTER TABLE targets ADD COLUMN IF NOT EXISTS connection_timeout_seconds INTEGER NOT NULL DEFAULT 30;
ALTER TABLE targets ADD COLUMN IF NOT EXISTS credential_version TEXT;
ALTER TABLE targets ADD COLUMN IF NOT EXISTS last_connection_test_status TEXT
    CHECK (last_connection_test_status IN ('HEALTHY', 'FAILED', 'TIMEOUT', 'AUTHENTICATION_FAILED', 'NETWORK_UNREACHABLE', 'SCHEMA_UNAVAILABLE'));
ALTER TABLE targets ADD COLUMN IF NOT EXISTS last_connection_test_at TIMESTAMPTZ;
ALTER TABLE targets ADD COLUMN IF NOT EXISTS last_connection_test_duration_ms INTEGER;
ALTER TABLE targets ADD COLUMN IF NOT EXISTS last_connection_test_error TEXT;
ALTER TABLE targets ADD COLUMN IF NOT EXISTS connection_updated_at TIMESTAMPTZ;
ALTER TABLE targets ADD COLUMN IF NOT EXISTS connection_updated_by TEXT;

CREATE INDEX IF NOT EXISTS targets_connection_status_idx
    ON targets (last_connection_test_status, last_connection_test_at DESC);
