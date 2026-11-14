ALTER TABLE "captures" DROP CONSTRAINT "captures_trigger_check";--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_trigger_check" CHECK ("captures"."trigger" IN ('user', 'admin_test', 'monitor', 'refresh', 'revisit')) NOT VALID;--> statement-breakpoint
ALTER TABLE "captures" VALIDATE CONSTRAINT "captures_trigger_check";
