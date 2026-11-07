CREATE TABLE "wishlist_opinion_devices" (
	"wishlist_id" uuid NOT NULL,
	"author_name_key" text NOT NULL,
	"device_key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlist_opinion_devices_pk" PRIMARY KEY("wishlist_id","author_name_key","device_key_hash")
);
--> statement-breakpoint
CREATE TABLE "wishlist_opinions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wishlist_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"author_name" text NOT NULL,
	"author_name_key" text NOT NULL,
	"level" smallint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlist_opinions_author_name_check" CHECK (char_length("wishlist_opinions"."author_name") BETWEEN 1 AND 40),
	CONSTRAINT "wishlist_opinions_level_check" CHECK ("wishlist_opinions"."level" BETWEEN 1 AND 4),
	CONSTRAINT "wishlist_opinions_note_check" CHECK ("wishlist_opinions"."note" IS NULL OR char_length("wishlist_opinions"."note") <= 400)
);
--> statement-breakpoint
ALTER TABLE "wishlists" ADD COLUMN "share_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "wishlists" ADD COLUMN "allow_opinions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "wishlists" ADD COLUMN "show_owner_name" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "wishlists" ADD COLUMN "show_owner_opinions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "wishlists" ADD COLUMN "show_budget" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wishlists" ADD COLUMN "opinions_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wishlist_opinion_devices" ADD CONSTRAINT "wishlist_opinion_devices_wishlist_id_wishlists_id_fk" FOREIGN KEY ("wishlist_id") REFERENCES "public"."wishlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_opinions" ADD CONSTRAINT "wishlist_opinions_wishlist_id_wishlists_id_fk" FOREIGN KEY ("wishlist_id") REFERENCES "public"."wishlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_opinions" ADD CONSTRAINT "wishlist_opinions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wishlist_opinions_author_idx" ON "wishlist_opinions" USING btree ("wishlist_id","item_id","author_name_key");--> statement-breakpoint
CREATE INDEX "wishlist_opinions_wishlist_id_updated_at_idx" ON "wishlist_opinions" USING btree ("wishlist_id","updated_at");--> statement-breakpoint
CREATE INDEX "wishlist_opinions_item_id_idx" ON "wishlist_opinions" USING btree ("item_id");