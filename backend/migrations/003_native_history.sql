SET search_path TO schemaops, public;

CREATE TABLE IF NOT EXISTS native_history_imports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_id UUID NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    engine TEXT NOT NULL CHECK (engine IN ('postgresql', 'mysql', 'oracle', 'sqlserver')),
    table_name TEXT NOT NULL,
    installed_rank INTEGER,
    version TEXT,
    description TEXT,
    checksum TEXT,
    success BOOLEAN NOT NULL,
    installed_at TIMESTAMPTZ,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS native_history_target_imported_idx
    ON native_history_imports (target_id, imported_at DESC);
