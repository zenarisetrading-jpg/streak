CREATE TABLE tracker_records (
 user_id TEXT NOT NULL,
 record_key TEXT NOT NULL,
 payload TEXT,
 PRIMARY KEY (user_id, record_key)
);
