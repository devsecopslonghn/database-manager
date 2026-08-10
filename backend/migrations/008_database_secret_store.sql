SET search_path TO schemaops, public;

CREATE TABLE IF NOT EXISTS secret_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    secret_ref TEXT NOT NULL UNIQUE,
    secret_type TEXT NOT NULL CHECK (secret_type IN ('DATABASE_CONNECTION', 'GIT_CREDENTIAL')),
    ciphertext TEXT NOT NULL,
    nonce TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    description TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS secret_records_updated_idx ON secret_records (updated_at DESC);

ALTER TABLE targets DROP CONSTRAINT IF EXISTS targets_secret_backend_check;
ALTER TABLE targets ADD CONSTRAINT targets_secret_backend_check CHECK (secret_backend IN ('database', 'kubernetes', 'vault', 'external-secrets'));
