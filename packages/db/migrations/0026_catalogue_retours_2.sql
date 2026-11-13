-- Retours fondatrice n°2 (catalogue « Découvrir »): the shop's own last change of each product, so a re-import skips the
-- products that did not change.
ALTER TABLE "products" ADD COLUMN "source_updated_at" timestamp with time zone;