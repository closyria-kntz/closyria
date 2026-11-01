CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp,
	"aaguid" text
);
--> statement-breakpoint
-- Hand-edited: existing sessions are backfilled before NOT NULL. Before this migration only anonymous
-- and e-mail code sign-ins existed, so the user's is_anonymous flag gives the exact method.
ALTER TABLE "session" ADD COLUMN "auth_method" text;--> statement-breakpoint
UPDATE "session" SET "auth_method" = CASE WHEN "user"."is_anonymous" THEN 'anonymous' ELSE 'email-otp' END FROM "user" WHERE "user"."id" = "session"."user_id";--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "auth_method" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passkey_userId_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
-- Hand-edited: unique (the plugin looks a passkey up by credential id with findOne). Same name as the
-- generated index, so the drizzle-kit snapshot still matches.
CREATE UNIQUE INDEX "passkey_credentialID_idx" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
-- Hand-written (not expressible in the generated Better Auth schema): allowed values.
ALTER TABLE "user" ADD CONSTRAINT "user_role_check" CHECK ("role" IN ('user', 'admin'));--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_auth_method_check" CHECK ("auth_method" IN ('anonymous', 'email-otp', 'google', 'apple', 'passkey'));
