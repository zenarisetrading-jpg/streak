-- People the owner invited from Settings. Household emails (ALLOWED_EMAILS) are not stored here.
CREATE TABLE people (
 email TEXT PRIMARY KEY,
 added_by TEXT NOT NULL,
 added_at TEXT NOT NULL
);
