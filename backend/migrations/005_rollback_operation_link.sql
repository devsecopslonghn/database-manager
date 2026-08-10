SET search_path TO schemaops, public;

ALTER TABLE operations ADD COLUMN IF NOT EXISTS source_operation_id UUID REFERENCES operations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS operations_source_operation_idx ON operations (source_operation_id);
