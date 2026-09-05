CREATE TABLE IF NOT EXISTS sync_states (
  subject TEXT PRIMARY KEY,
  state JSONB NOT NULL,
  sequence BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_mutations (
  subject TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  sequence BIGINT NOT NULL,
  mutation JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subject, mutation_id)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sync_mutations' AND column_name = 'mutation_id' AND data_type <> 'text'
  ) THEN
    ALTER TABLE sync_mutations ALTER COLUMN mutation_id TYPE TEXT USING mutation_id::text;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS novel_id_mappings (
  subject TEXT NOT NULL,
  device_id TEXT NOT NULL,
  local_novel_id TEXT NOT NULL,
  canonical_novel_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subject, device_id, local_novel_id)
);

CREATE TABLE IF NOT EXISTS sync_mutation_receipts (
  subject TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subject, mutation_id)
);

CREATE TABLE IF NOT EXISTS purged_novel_ids (
  subject TEXT NOT NULL,
  canonical_novel_id TEXT NOT NULL,
  purged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subject, canonical_novel_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_mutations_subject_sequence
  ON sync_mutations (subject, sequence);

INSERT INTO sync_mutation_receipts (subject, mutation_id)
SELECT subject, mutation_id FROM sync_mutations
ON CONFLICT DO NOTHING;
