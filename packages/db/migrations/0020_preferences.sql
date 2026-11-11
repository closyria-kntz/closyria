ALTER TABLE "user" ADD COLUMN "seen_tips" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
UPDATE "user" SET "onboarded_at" = now() WHERE EXISTS (SELECT 1 FROM "items" WHERE "items"."user_id" = "user"."id");
