CREATE TABLE "wishlist_gifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wishlist_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"giver_name" text NOT NULL,
	"giver_name_key" text NOT NULL,
	"role" text NOT NULL,
	"item_removed_at" timestamp with time zone,
	"owner_took_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlist_gifts_role_check" CHECK ("wishlist_gifts"."role" IN ('reserver', 'contributor')),
	CONSTRAINT "wishlist_gifts_giver_name_check" CHECK (char_length("wishlist_gifts"."giver_name") BETWEEN 1 AND 320)
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "gift_from" text;--> statement-breakpoint
ALTER TABLE "wishlists" ADD COLUMN "allow_gifts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wishlists" ADD COLUMN "gift_occasion" text;--> statement-breakpoint
ALTER TABLE "wishlists" ADD COLUMN "gift_date" date;--> statement-breakpoint
ALTER TABLE "wishlists" ADD COLUMN "gift_reminder_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wishlists" ADD COLUMN "gift_reminder_snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wishlist_gifts" ADD CONSTRAINT "wishlist_gifts_wishlist_id_wishlists_id_fk" FOREIGN KEY ("wishlist_id") REFERENCES "public"."wishlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_gifts" ADD CONSTRAINT "wishlist_gifts_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wishlist_gifts_giver_idx" ON "wishlist_gifts" USING btree ("wishlist_id","item_id","giver_name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "wishlist_gifts_reserver_idx" ON "wishlist_gifts" USING btree ("wishlist_id","item_id") WHERE "wishlist_gifts"."role" = 'reserver';--> statement-breakpoint
CREATE INDEX "wishlist_gifts_item_id_idx" ON "wishlist_gifts" USING btree ("item_id");--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_gift_occasion_check" CHECK ("wishlists"."gift_occasion" IS NULL OR char_length("wishlists"."gift_occasion") BETWEEN 1 AND 320);