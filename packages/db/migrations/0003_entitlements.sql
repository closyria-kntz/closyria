CREATE TABLE "plan_entitlements" (
	"plan_id" text NOT NULL,
	"key" text NOT NULL,
	"limit_value" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "plan_entitlements_plan_id_key_pk" PRIMARY KEY("plan_id","key"),
	CONSTRAINT "plan_entitlements_limit_check" CHECK ("plan_entitlements"."limit_value" IS NULL OR "plan_entitlements"."limit_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"period" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counters_user_id_key_period_pk" PRIMARY KEY("user_id","key","period"),
	CONSTRAINT "usage_counters_value_check" CHECK ("usage_counters"."value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "user_plans" (
	"user_id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"source" text DEFAULT 'default' NOT NULL,
	CONSTRAINT "user_plans_source_check" CHECK ("user_plans"."source" IN ('default', 'stripe', 'gift'))
);
--> statement-breakpoint
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_plans" ADD CONSTRAINT "user_plans_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_plans" ADD CONSTRAINT "user_plans_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Hand-written: default plan « Gratuit » (stable id `free`) with starting values, edited in the admin later.
INSERT INTO "plans" ("id", "name", "visible", "version") VALUES ('free', 'Gratuit', true, 1);--> statement-breakpoint
INSERT INTO "plan_entitlements" ("plan_id", "key", "limit_value", "enabled") VALUES
	('free', 'wardrobe_items', 300, true),
	('free', 'active_alerts', 50, true),
	('free', 'cutouts_per_month', 20, true),
	('free', 'order_emails_per_month', 20, true),
	('free', 'ai_calls_per_month', 20, true);
