-- The clean copy as it was before the last "Fix", so the child can put it back.
ALTER TABLE clean_copies ADD COLUMN prev_data TEXT;
