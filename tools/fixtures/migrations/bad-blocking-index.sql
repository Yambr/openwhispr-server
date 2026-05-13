-- Bad fixture: index without CONCURRENTLY blocks writes.
-- squawk: require-concurrent-index-creation.
CREATE INDEX users_email_idx ON users(email);
