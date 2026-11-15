CREATE TABLE "order_sender_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"verified_at" timestamp with time zone,
	"code_hash" text,
	"code_salt" text,
	"code_expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_sender_addresses_email_check" CHECK (char_length("order_sender_addresses"."email") BETWEEN 3 AND 254 AND "order_sender_addresses"."email" = lower("order_sender_addresses"."email")),
	CONSTRAINT "order_sender_addresses_attempts_check" CHECK ("order_sender_addresses"."attempts" >= 0),
	CONSTRAINT "order_sender_addresses_code_check" CHECK ("order_sender_addresses"."verified_at" IS NULL OR ("order_sender_addresses"."code_hash" IS NULL AND "order_sender_addresses"."code_salt" IS NULL AND "order_sender_addresses"."code_expires_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "order_sender_sends" (
	"user_id" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"sends" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_sender_addresses" ADD CONSTRAINT "order_sender_addresses_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_sender_sends" ADD CONSTRAINT "order_sender_sends_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_sender_addresses_user_id_email_idx" ON "order_sender_addresses" USING btree ("user_id","email");