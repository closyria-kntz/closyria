CREATE TABLE "item_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"type" text NOT NULL,
	"stage" text,
	"from_profile_id" uuid,
	"to_profile_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"amount_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_events_type_check" CHECK ("item_events"."type" IN ('stage', 'profile')),
	CONSTRAINT "item_events_stage_check" CHECK ("item_events"."stage" IS NULL OR "item_events"."stage" IN ('spotted', 'ordered', 'owned', 'for_sale', 'sold', 'returned')),
	CONSTRAINT "item_events_amount_check" CHECK ("item_events"."amount_cents" IS NULL OR "item_events"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "item_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_tags" (
	"item_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "item_tags_item_id_tag_id_pk" PRIMARY KEY("item_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"product_id" uuid,
	"stage" text DEFAULT 'spotted' NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"size_label" text,
	"size_note" text,
	"notes" text,
	"price_paid_cents" integer,
	"sale_price_cents" integer,
	"sale_channel" text,
	"name_override" text,
	"brand_override" text,
	"category_id" uuid,
	"color_id" uuid,
	"cover_media_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_stage_check" CHECK ("items"."stage" IN ('spotted', 'ordered', 'owned', 'for_sale', 'sold', 'returned')),
	CONSTRAINT "items_size_label_check" CHECK ("items"."size_label" IS NULL OR char_length("items"."size_label") <= 40),
	CONSTRAINT "items_size_note_check" CHECK ("items"."size_note" IS NULL OR char_length("items"."size_note") <= 200),
	CONSTRAINT "items_notes_check" CHECK ("items"."notes" IS NULL OR char_length("items"."notes") <= 2000),
	CONSTRAINT "items_sale_channel_check" CHECK ("items"."sale_channel" IS NULL OR char_length("items"."sale_channel") <= 60),
	CONSTRAINT "items_cents_check" CHECK (("items"."price_paid_cents" IS NULL OR "items"."price_paid_cents" >= 0) AND ("items"."sale_price_cents" IS NULL OR "items"."sale_price_cents" >= 0))
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"audience" text NOT NULL,
	"child_detail" text,
	"color" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_name_check" CHECK (char_length("profiles"."name") BETWEEN 1 AND 40),
	CONSTRAINT "profiles_audience_check" CHECK ("profiles"."audience" IN ('women', 'men', 'child', 'mixed')),
	CONSTRAINT "profiles_child_detail_check" CHECK ("profiles"."child_detail" IS NULL OR "profiles"."child_detail" IN ('girl', 'boy', 'baby')),
	CONSTRAINT "profiles_color_check" CHECK ("profiles"."color" IN ('plum', 'rose', 'sage', 'sand', 'sky', 'slate'))
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	CONSTRAINT "tags_name_check" CHECK (char_length("tags"."name") BETWEEN 1 AND 40),
	CONSTRAINT "tags_color_check" CHECK ("tags"."color" IS NULL OR "tags"."color" IN ('plum', 'rose', 'sage', 'sand', 'sky', 'slate'))
);
--> statement-breakpoint
CREATE TABLE "wishlist_items" (
	"wishlist_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlist_items_wishlist_id_item_id_pk" PRIMARY KEY("wishlist_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "wishlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"share_token_hash" text,
	"shared_at" timestamp with time zone,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlists_share_token_hash_unique" UNIQUE("share_token_hash"),
	CONSTRAINT "wishlists_name_check" CHECK (char_length("wishlists"."name") BETWEEN 1 AND 80)
);
--> statement-breakpoint
ALTER TABLE "item_events" ADD CONSTRAINT "item_events_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_events" ADD CONSTRAINT "item_events_from_profile_id_profiles_id_fk" FOREIGN KEY ("from_profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_events" ADD CONSTRAINT "item_events_to_profile_id_profiles_id_fk" FOREIGN KEY ("to_profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_media" ADD CONSTRAINT "item_media_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_media" ADD CONSTRAINT "item_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tags" ADD CONSTRAINT "item_tags_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tags" ADD CONSTRAINT "item_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_color_id_colors_id_fk" FOREIGN KEY ("color_id") REFERENCES "public"."colors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_wishlist_id_wishlists_id_fk" FOREIGN KEY ("wishlist_id") REFERENCES "public"."wishlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_events_item_id_at_idx" ON "item_events" USING btree ("item_id","at");--> statement-breakpoint
CREATE INDEX "item_media_item_id_idx" ON "item_media" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_media_item_id_media_id_idx" ON "item_media" USING btree ("item_id","media_id");--> statement-breakpoint
CREATE INDEX "item_tags_tag_id_idx" ON "item_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "items_user_id_stage_idx" ON "items" USING btree ("user_id","stage");--> statement-breakpoint
CREATE INDEX "items_profile_id_idx" ON "items" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "items_product_id_idx" ON "items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "items_user_id_product_id_active_idx" ON "items" USING btree ("user_id","product_id") WHERE "items"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "profiles_user_id_idx" ON "profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_user_id_lower_name_idx" ON "tags" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "wishlist_items_item_id_idx" ON "wishlist_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "wishlists_user_id_idx" ON "wishlists" USING btree ("user_id");