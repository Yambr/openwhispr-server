-- Bad fixture: NOT NULL on new column without default rewrites the table.
-- squawk: adding-required-field.
ALTER TABLE users ADD COLUMN locked_at TIMESTAMPTZ NOT NULL;
