ALTER TABLE "user" ADD COLUMN "is_tester" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "listing_agreement_at" timestamp with time zone;