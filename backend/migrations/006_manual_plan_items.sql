SET search_path TO schemaops, public;

ALTER TABLE migration_plan_items
  ADD COLUMN IF NOT EXISTS manual_migration_id UUID REFERENCES manual_migrations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS migration_plan_items_manual_idx
  ON migration_plan_items (manual_migration_id);
