CREATE TABLE "photo_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"url" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error_code" text,
	"media_key" text,
	"content_type" text,
	"size_bytes" integer,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_imports_url_check" CHECK (char_length("photo_imports"."url") BETWEEN 1 AND 2048),
	CONSTRAINT "photo_imports_status_check" CHECK ("photo_imports"."status" IN ('queued', 'ready', 'failed', 'attached')),
	CONSTRAINT "photo_imports_error_code_check" CHECK ("photo_imports"."error_code" IS NULL OR "photo_imports"."error_code" IN ('blocked', 'timeout', 'too_large', 'unsupported', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "recent_products" (
	"user_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"visited_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recent_products_user_id_product_id_pk" PRIMARY KEY("user_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "photo_imports" ADD CONSTRAINT "photo_imports_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_imports" ADD CONSTRAINT "photo_imports_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recent_products" ADD CONSTRAINT "recent_products_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recent_products" ADD CONSTRAINT "recent_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photo_imports_user_id_idx" ON "photo_imports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "photo_imports_item_id_idx" ON "photo_imports" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "photo_imports_created_at_idx" ON "photo_imports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "recent_products_user_id_visited_at_idx" ON "recent_products" USING btree ("user_id","visited_at" DESC NULLS LAST);