-- Persist row hidden state in Stellenplan
ALTER TABLE employees ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;
