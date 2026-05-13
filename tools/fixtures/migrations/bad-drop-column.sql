-- Bad fixture: dropping a column breaks N-1 pods during rolling deploy.
-- squawk: ban-drop-column.
ALTER TABLE users DROP COLUMN legacy_field;
