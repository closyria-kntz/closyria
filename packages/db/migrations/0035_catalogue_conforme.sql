ALTER TABLE "captures" DROP CONSTRAINT "captures_trigger_check";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_tester" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "pasted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "listing_agreement_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "products_pasted_idx" ON "products" USING btree ("shop_id","published_at") WHERE "products"."pasted_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_trigger_check" CHECK ("captures"."trigger" IN ('user', 'admin_test', 'monitor', 'refresh', 'revisit', 'admin_recapture'));--> statement-breakpoint
-- Catalogue conforme (docs/specs/2026-11-14-catalogue-conforme.md): `products.pasted_at` is the first time someone
-- neither admin nor « Testeuse » pasted the product (her user capture succeeded, or was recorded for a manual shop)
-- or kept an item on it. Never cleared. A capture without a requester (a friend on a shared link, or an account
-- deleted since) counts. The admin's « Recapturer » has its own trigger (`admin_recapture`) and never counts.
CREATE OR REPLACE FUNCTION catalog_publisher(person text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT person IS NULL OR NOT EXISTS (
    SELECT 1 FROM "user" u WHERE u.id = person AND (u.role = 'admin' OR u.is_tester)
  )
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION products_mark_pasted_by_capture() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.trigger = 'user' AND NEW.product_id IS NOT NULL AND NEW.status IN ('succeeded', 'skipped_manual')
     AND catalog_publisher(NEW.requested_by) THEN
    UPDATE products SET pasted_at = now() WHERE id = NEW.product_id AND pasted_at IS NULL;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER products_mark_pasted_capture
AFTER INSERT OR UPDATE OF status ON captures
FOR EACH ROW EXECUTE FUNCTION products_mark_pasted_by_capture();--> statement-breakpoint
CREATE OR REPLACE FUNCTION products_mark_pasted_by_item() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.product_id IS NOT NULL AND NEW.user_id IS NOT NULL AND catalog_publisher(NEW.user_id) THEN
    UPDATE products SET pasted_at = now() WHERE id = NEW.product_id AND pasted_at IS NULL;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER products_mark_pasted_item
AFTER INSERT OR UPDATE OF product_id, user_id ON items
FOR EACH ROW EXECUTE FUNCTION products_mark_pasted_by_item();--> statement-breakpoint
-- Backfill from the rule above, with the earliest qualifying date.
UPDATE products p SET pasted_at = least(
  (SELECT min(c.created_at) FROM captures c
    WHERE c.product_id = p.id AND c.trigger = 'user' AND c.status IN ('succeeded', 'skipped_manual')
      AND catalog_publisher(c.requested_by)),
  (SELECT min(i.created_at) FROM items i WHERE i.product_id = p.id AND catalog_publisher(i.user_id))
)
WHERE p.pasted_at IS NULL;
