DROP INDEX "wishlist_gifts_giver_idx";--> statement-breakpoint
DROP INDEX "wishlist_gifts_reserver_idx";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "gift_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wishlist_gifts" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "wishlist_gifts_giver_idx" ON "wishlist_gifts" USING btree ("wishlist_id","item_id","giver_name_key") WHERE "wishlist_gifts"."received_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "wishlist_gifts_reserver_idx" ON "wishlist_gifts" USING btree ("wishlist_id","item_id") WHERE "wishlist_gifts"."role" = 'reserver' AND "wishlist_gifts"."received_at" IS NULL;