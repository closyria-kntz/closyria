-- Retours fondatrice n°2 (catalogue « Découvrir »): a hash of what the import last wrote for each product, so a
-- re-import skips the products whose content did not change.
ALTER TABLE "products" ADD COLUMN "source_hash" text;