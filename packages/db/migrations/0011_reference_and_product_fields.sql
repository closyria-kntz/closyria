CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "colors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"hex" text NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "colors_slug_unique" UNIQUE("slug"),
	CONSTRAINT "colors_hex_check" CHECK ("colors"."hex" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "materials_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "patterns_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "gtin" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "sku" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "shop_data" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "audience" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "child_detail" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "color_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "material_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "pattern_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "season" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "classified_by" text DEFAULT 'rule' NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_parent_id_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_color_id_colors_id_fk" FOREIGN KEY ("color_id") REFERENCES "public"."colors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_pattern_id_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."patterns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_category_id_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_color_id_idx" ON "products" USING btree ("color_id");--> statement-breakpoint
CREATE INDEX "products_material_id_idx" ON "products" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "products_pattern_id_idx" ON "products" USING btree ("pattern_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_audience_check" CHECK ("products"."audience" IS NULL OR "products"."audience" IN ('women', 'men', 'child', 'mixed'));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_child_detail_check" CHECK ("products"."child_detail" IS NULL OR "products"."child_detail" IN ('girl', 'boy', 'baby'));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_season_check" CHECK ("products"."season" IS NULL OR "products"."season" IN ('summer', 'winter', 'mid', 'all'));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_classified_by_check" CHECK ("products"."classified_by" IN ('rule', 'admin'));