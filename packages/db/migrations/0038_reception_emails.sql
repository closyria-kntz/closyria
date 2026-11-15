ALTER TABLE "inbound_emails" ADD COLUMN "queue_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "order_inboxes" ADD COLUMN "gmail_code" text;--> statement-breakpoint
ALTER TABLE "order_inboxes" ADD COLUMN "gmail_code_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_emails_inbox_id_queue_id_idx" ON "inbound_emails" USING btree ("inbox_id","queue_id");--> statement-breakpoint
ALTER TABLE "order_inboxes" ADD CONSTRAINT "order_inboxes_gmail_code_check" CHECK ("order_inboxes"."gmail_code" IS NULL OR "order_inboxes"."gmail_code" ~ '^[0-9]{6,12}$');