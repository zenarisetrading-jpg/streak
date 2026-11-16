CREATE TABLE health_tokens (
 user_id TEXT PRIMARY KEY,
 token_hash TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL
);
