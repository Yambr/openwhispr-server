-- Good fixture: NOT VALID + VALIDATE pattern, squawk-clean.
ALTER TABLE users
  ADD CONSTRAINT users_email_unique UNIQUE (email) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT users_email_unique;
