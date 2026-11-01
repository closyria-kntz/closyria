CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"device" text,
	"props" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_device_check" CHECK ("events"."device" IS NULL OR "events"."device" IN ('mobile', 'desktop', 'tablet'))
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_name_occurred_at_idx" ON "events" USING btree ("name","occurred_at");--> statement-breakpoint
CREATE INDEX "events_user_id_idx" ON "events" USING btree ("user_id");