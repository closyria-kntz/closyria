CREATE TABLE "crawl_slowdowns" (
	"platform" text PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crawl_slowdowns_level_check" CHECK ("crawl_slowdowns"."level" IN ('doubled', 'nightly'))
);
--> statement-breakpoint
ALTER TABLE "captures" DROP CONSTRAINT "captures_trigger_check";--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_trigger_check" CHECK ("captures"."trigger" IN ('user', 'admin_test', 'monitor', 'refresh'));