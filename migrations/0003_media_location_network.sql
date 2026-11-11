-- Non-destructive extension: existing cafe rows and Wi-Fi data are preserved.
ALTER TABLE cafes ADD COLUMN photo_url TEXT NOT NULL DEFAULT '';
ALTER TABLE cafes ADD COLUMN photo_key TEXT NOT NULL DEFAULT '';
ALTER TABLE cafes ADD COLUMN latitude REAL;
ALTER TABLE cafes ADD COLUMN longitude REAL;
ALTER TABLE cafes ADD COLUMN provider TEXT NOT NULL DEFAULT '';
ALTER TABLE cafes ADD COLUMN tested_at TEXT NOT NULL DEFAULT '';
ALTER TABLE cafes ADD COLUMN jitter_ms REAL;
CREATE UNIQUE INDEX IF NOT EXISTS cafes_photo_key_unique ON cafes(photo_key) WHERE photo_key <> '';
