CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO records (id, payload)
SELECT n, 'workshop-record-' || n
FROM generate_series(1, 10000) AS n
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS records_id_idx ON records (id);
