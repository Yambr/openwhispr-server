-- Good fixture: concurrent index creation, squawk-clean.
CREATE INDEX CONCURRENTLY IF NOT EXISTS users_email_idx ON users(email);
