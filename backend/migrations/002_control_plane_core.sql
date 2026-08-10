SET search_path TO schemaops, public;

CREATE TABLE IF NOT EXISTS users (
    subject TEXT PRIMARY KEY,
    email TEXT,
    display_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (name IN ('TENANT_ADMIN', 'OPERATOR', 'VIEWER')),
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS memberships (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    subject TEXT NOT NULL REFERENCES users(subject) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, subject)
);

CREATE TABLE IF NOT EXISTS role_bindings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    subject TEXT NOT NULL REFERENCES users(subject) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('TENANT_ADMIN', 'OPERATOR', 'VIEWER')),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    environment_id UUID REFERENCES environments(id) ON DELETE CASCADE,
    target_id UUID REFERENCES targets(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (target_id IS NULL OR environment_id IS NOT NULL),
    CHECK (environment_id IS NULL OR project_id IS NOT NULL),
    UNIQUE (tenant_id, subject, role, project_id, environment_id, target_id)
);

CREATE TABLE IF NOT EXISTS repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    default_ref TEXT NOT NULL,
    migration_path TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'git',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    git_ref TEXT NOT NULL,
    commit_sha TEXT NOT NULL,
    source_fingerprint TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('SYNCING', 'SUCCEEDED', 'FAILED')),
    error_message TEXT,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, git_ref, commit_sha)
);

CREATE TABLE IF NOT EXISTS migration_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL REFERENCES source_snapshots(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('VERSIONED', 'REPEATABLE', 'UNDO')),
    version TEXT,
    description TEXT NOT NULL,
    checksum TEXT NOT NULL,
    sql_payload TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (snapshot_id, path)
);

CREATE TABLE IF NOT EXISTS migration_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_id UUID NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('GIT', 'MANUAL_UI', 'NATIVE_IMPORT')),
    migration_file_id UUID REFERENCES migration_files(id) ON DELETE SET NULL,
    path TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('VERSIONED', 'REPEATABLE', 'UNDO', 'MANUAL')),
    version TEXT,
    description TEXT NOT NULL,
    checksum TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('APPLIED', 'ROLLED_BACK', 'FAILED')),
    out_of_order BOOLEAN NOT NULL DEFAULT FALSE,
    execution_sequence INTEGER NOT NULL,
    operation_id UUID,
    actor_id TEXT NOT NULL,
    duration_ms INTEGER,
    error_message TEXT,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS migration_ledger_target_applied_idx
    ON migration_ledger (target_id, applied_at DESC);

CREATE TABLE IF NOT EXISTS migration_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_id UUID NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    snapshot_id UUID REFERENCES source_snapshots(id) ON DELETE SET NULL,
    from_version TEXT,
    to_version TEXT,
    status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PREFLIGHT_PASSED', 'APPROVAL_REQUIRED', 'APPROVED', 'REJECTED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    fingerprint TEXT NOT NULL,
    auto_approve BOOLEAN NOT NULL DEFAULT FALSE,
    created_by TEXT NOT NULL,
    approved_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS migration_plan_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES migration_plans(id) ON DELETE CASCADE,
    migration_file_id UUID REFERENCES migration_files(id) ON DELETE SET NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('GIT', 'MANUAL_UI')),
    path TEXT NOT NULL,
    kind TEXT NOT NULL,
    version TEXT,
    checksum TEXT NOT NULL,
    execution_sequence INTEGER NOT NULL,
    out_of_order BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED')),
    UNIQUE (plan_id, execution_sequence)
);

CREATE TABLE IF NOT EXISTS approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES migration_plans(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_id UUID NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    plan_id UUID REFERENCES migration_plans(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('SYNC', 'PREFLIGHT', 'EXECUTE', 'UNDO', 'RESTORE', 'BACKUP')),
    status TEXT NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'PAUSED', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    actor_id TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS operation_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id UUID NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
    plan_item_id UUID REFERENCES migration_plan_items(id) ON DELETE SET NULL,
    sequence INTEGER NOT NULL,
    path TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED')),
    duration_ms INTEGER,
    error_message TEXT,
    UNIQUE (operation_id, sequence)
);

CREATE TABLE IF NOT EXISTS execution_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id UUID NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
    operation_item_id UUID REFERENCES operation_items(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    stream TEXT NOT NULL CHECK (stream IN ('stdout', 'stderr', 'system')),
    message TEXT NOT NULL,
    redacted BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (operation_id, sequence)
);

CREATE TABLE IF NOT EXISTS backup_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_id UUID NOT NULL UNIQUE REFERENCES targets(id) ON DELETE CASCADE,
    script_ref TEXT NOT NULL,
    required_before_execute BOOLEAN NOT NULL DEFAULT TRUE,
    retention_days INTEGER NOT NULL DEFAULT 30,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backup_artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_id UUID NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    operation_id UUID REFERENCES operations(id) ON DELETE SET NULL,
    scope_from_version TEXT,
    scope_to_version TEXT,
    artifact_ref TEXT,
    checksum TEXT,
    status TEXT NOT NULL CHECK (status IN ('REQUESTED', 'SUCCEEDED', 'FAILED', 'EXPIRED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS target_locks (
    target_id UUID PRIMARY KEY REFERENCES targets(id) ON DELETE CASCADE,
    operation_id UUID NOT NULL,
    holder_id TEXT NOT NULL,
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    key TEXT NOT NULL,
    operation_id UUID,
    response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, actor_id, key)
);

CREATE INDEX IF NOT EXISTS migration_files_snapshot_order_idx
    ON migration_files (snapshot_id, kind, version, path);
CREATE INDEX IF NOT EXISTS migration_plans_target_created_idx
    ON migration_plans (target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS operations_target_created_idx
    ON operations (target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS execution_logs_operation_sequence_idx
    ON execution_logs (operation_id, sequence);
CREATE INDEX IF NOT EXISTS role_bindings_subject_scope_idx
    ON role_bindings (tenant_id, subject, project_id, environment_id, target_id);
