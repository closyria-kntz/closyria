CREATE TABLE "shop_shipping_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"label" text NOT NULL,
	"shipping_cents" integer NOT NULL,
	"free_from_cents" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_shipping_options_label_check" CHECK (char_length("shop_shipping_options"."label") BETWEEN 1 AND 320),
	CONSTRAINT "shop_shipping_options_shipping_check" CHECK ("shop_shipping_options"."shipping_cents" >= 0),
	CONSTRAINT "shop_shipping_options_free_from_check" CHECK ("shop_shipping_options"."free_from_cents" IS NULL OR "shop_shipping_options"."free_from_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "group_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_order_id" uuid NOT NULL,
	"buyer_name" text,
	"buyer_name_key" text,
	"item_id" uuid,
	"product_id" uuid,
	"url" text,
	"manual_name" text,
	"manual_price_cents" integer,
	"size_label" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"final_price_cents" integer,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_order_lines_quantity_check" CHECK ("group_order_lines"."quantity" BETWEEN 1 AND 5),
	CONSTRAINT "group_order_lines_manual_name_check" CHECK ("group_order_lines"."manual_name" IS NULL OR char_length("group_order_lines"."manual_name") BETWEEN 1 AND 960),
	CONSTRAINT "group_order_lines_size_label_check" CHECK ("group_order_lines"."size_label" IS NULL OR char_length("group_order_lines"."size_label") <= 320),
	CONSTRAINT "group_order_lines_buyer_name_check" CHECK ("group_order_lines"."buyer_name" IS NULL OR char_length("group_order_lines"."buyer_name") BETWEEN 1 AND 320),
	CONSTRAINT "group_order_lines_prices_check" CHECK (("group_order_lines"."manual_price_cents" IS NULL OR "group_order_lines"."manual_price_cents" >= 0) AND ("group_order_lines"."final_price_cents" IS NULL OR "group_order_lines"."final_price_cents" >= 0)),
	CONSTRAINT "group_order_lines_source_check" CHECK ("group_order_lines"."product_id" IS NOT NULL OR "group_order_lines"."manual_name" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "group_order_payments" (
	"group_order_id" uuid NOT NULL,
	"buyer_name_key" text NOT NULL,
	"buyer_name" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "group_order_payments_group_order_id_buyer_name_key_pk" PRIMARY KEY("group_order_id","buyer_name_key"),
	CONSTRAINT "group_order_payments_amount_check" CHECK ("group_order_payments"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "group_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wishlist_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"deadline" date,
	"shipping_label" text NOT NULL,
	"shipping_cents" integer NOT NULL,
	"free_from_cents" integer,
	"currency" text NOT NULL,
	"ordered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_orders_status_check" CHECK ("group_orders"."status" IN ('open', 'closed', 'ordered', 'cancelled')),
	CONSTRAINT "group_orders_shipping_label_check" CHECK (char_length("group_orders"."shipping_label") BETWEEN 1 AND 320),
	CONSTRAINT "group_orders_shipping_check" CHECK ("group_orders"."shipping_cents" >= 0),
	CONSTRAINT "group_orders_free_from_check" CHECK ("group_orders"."free_from_cents" IS NULL OR "group_orders"."free_from_cents" > 0),
	CONSTRAINT "group_orders_currency_check" CHECK (char_length("group_orders"."currency") = 3)
);
--> statement-breakpoint
ALTER TABLE "shop_shipping_options" ADD CONSTRAINT "shop_shipping_options_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_order_lines" ADD CONSTRAINT "group_order_lines_group_order_id_group_orders_id_fk" FOREIGN KEY ("group_order_id") REFERENCES "public"."group_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_order_lines" ADD CONSTRAINT "group_order_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_order_lines" ADD CONSTRAINT "group_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_order_payments" ADD CONSTRAINT "group_order_payments_group_order_id_group_orders_id_fk" FOREIGN KEY ("group_order_id") REFERENCES "public"."group_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_orders" ADD CONSTRAINT "group_orders_wishlist_id_wishlists_id_fk" FOREIGN KEY ("wishlist_id") REFERENCES "public"."wishlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_orders" ADD CONSTRAINT "group_orders_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shop_shipping_options_shop_id_idx" ON "shop_shipping_options" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "group_order_lines_group_order_id_idx" ON "group_order_lines" USING btree ("group_order_id");--> statement-breakpoint
CREATE INDEX "group_order_lines_item_id_idx" ON "group_order_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "group_order_lines_product_id_idx" ON "group_order_lines" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_orders_running_idx" ON "group_orders" USING btree ("wishlist_id") WHERE "group_orders"."status" IN ('open', 'closed');--> statement-breakpoint
CREATE INDEX "group_orders_shop_id_idx" ON "group_orders" USING btree ("shop_id");