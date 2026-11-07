CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" uuid,
	"wishlist_id" uuid,
	"amount_cents" integer NOT NULL,
	"period" text NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"reset_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_target_check" CHECK (("budgets"."profile_id" IS NULL) <> ("budgets"."wishlist_id" IS NULL)),
	CONSTRAINT "budgets_amount_check" CHECK ("budgets"."amount_cents" > 0),
	CONSTRAINT "budgets_period_check" CHECK ("budgets"."period" IN ('week', 'month', 'custom', 'none')),
	CONSTRAINT "budgets_dates_check" CHECK (CASE WHEN "budgets"."period" = 'custom' THEN "budgets"."starts_on" IS NOT NULL AND "budgets"."ends_on" IS NOT NULL AND "budgets"."starts_on" <= "budgets"."ends_on" ELSE "budgets"."starts_on" IS NULL AND "budgets"."ends_on" IS NULL END)
);
--> statement-breakpoint
CREATE TABLE "love_levels" (
	"user_id" text NOT NULL,
	"level" smallint NOT NULL,
	"emoji" text NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "love_levels_user_id_level_pk" PRIMARY KEY("user_id","level"),
	CONSTRAINT "love_levels_level_check" CHECK ("love_levels"."level" BETWEEN 1 AND 4),
	CONSTRAINT "love_levels_emoji_check" CHECK (octet_length("love_levels"."emoji") BETWEEN 1 AND 16),
	CONSTRAINT "love_levels_label_check" CHECK (char_length("love_levels"."label") BETWEEN 1 AND 20)
);
--> statement-breakpoint
ALTER TABLE "item_events" ADD COLUMN "spent_cents" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "love_level" smallint;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "priority" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "why" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "in_order_draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_wishlist_id_wishlists_id_fk" FOREIGN KEY ("wishlist_id") REFERENCES "public"."wishlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "love_levels" ADD CONSTRAINT "love_levels_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budgets_user_id_idx" ON "budgets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_profile_id_idx" ON "budgets" USING btree ("profile_id") WHERE "budgets"."profile_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_wishlist_id_idx" ON "budgets" USING btree ("wishlist_id") WHERE "budgets"."wishlist_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "items_order_draft_idx" ON "items" USING btree ("user_id","profile_id") WHERE "items"."in_order_draft";--> statement-breakpoint
-- The former favorites become « J'aime » (2); the others have no level.
UPDATE "items" SET "love_level" = 2 WHERE "favorite";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "favorite";--> statement-breakpoint
ALTER TABLE "item_events" ADD CONSTRAINT "item_events_spent_check" CHECK ("item_events"."spent_cents" IS NULL OR "item_events"."spent_cents" >= 0);--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_love_level_check" CHECK ("items"."love_level" IS NULL OR "items"."love_level" BETWEEN 1 AND 4);--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_why_check" CHECK ("items"."why" IS NULL OR char_length("items"."why") <= 200);