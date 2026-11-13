ALTER TABLE "shops" ADD COLUMN "import_heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "import_expected" integer;