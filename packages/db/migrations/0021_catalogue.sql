CREATE TABLE "product_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_reports_product_user_unique" UNIQUE("product_id","user_id"),
	CONSTRAINT "product_reports_reason_check" CHECK ("product_reports"."reason" IN ('not_fashion', 'shocking', 'other'))
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "category_source" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "values" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "import_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "last_import_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "last_import_error" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "size_top" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "size_bottom" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "size_shoes" text;--> statement-breakpoint
ALTER TABLE "product_reports" ADD CONSTRAINT "product_reports_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reports" ADD CONSTRAINT "product_reports_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_source_check" CHECK ("products"."category_source" IN ('auto', 'admin'));--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_values_check" CHECK ("shops"."values" <@ ARRAY['made_in_france', 'second_hand', 'eco_responsible', 'free_returns']::text[]);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_size_top_check" CHECK (char_length("profiles"."size_top") <= 10);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_size_bottom_check" CHECK (char_length("profiles"."size_bottom") <= 10);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_size_shoes_check" CHECK (char_length("profiles"."size_shoes") <= 10);