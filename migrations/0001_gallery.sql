-- Migration number: 0001 	 2026-08-21
-- One row per uploaded item. Bytes live in R2 under media/<id>/<variant>.<ext>.
CREATE TABLE media (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('image','video')),
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','ready')),
  created_at INTEGER NOT NULL,
  ready_at INTEGER,
  uploader_name TEXT,
  device_id TEXT NOT NULL,
  ip_hash TEXT,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  original_key TEXT,
  original_mime TEXT,
  original_bytes INTEGER,
  display_key TEXT,
  thumb_key TEXT,
  hidden_at INTEGER,
  hidden_by TEXT CHECK (hidden_by IN ('admin','owner'))
);

CREATE INDEX media_feed   ON media (status, hidden_at, ready_at DESC, id);
CREATE INDEX media_device ON media (device_id, created_at);
CREATE INDEX media_ip     ON media (ip_hash, created_at);
