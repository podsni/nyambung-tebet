ALTER TABLE cafes ADD COLUMN google_rating REAL;
ALTER TABLE cafes ADD COLUMN google_rating_count INTEGER;
ALTER TABLE cafes ADD COLUMN nyambung_rating REAL NOT NULL DEFAULT 0;
ALTER TABLE cafes ADD COLUMN nyambung_rating_count INTEGER NOT NULL DEFAULT 0;

UPDATE cafes SET google_rating = rating WHERE rating IS NOT NULL;

CREATE TABLE IF NOT EXISTS cafe_ratings (
  cafe_id TEXT NOT NULL,
  voter_hash TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (cafe_id, voter_hash),
  FOREIGN KEY (cafe_id) REFERENCES cafes(id) ON DELETE CASCADE
);
