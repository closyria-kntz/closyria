CREATE TABLE "listing_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"shop_name" text NOT NULL,
	"site_url" text NOT NULL,
	"signer_name" text,
	"signer_email" text,
	"message" text,
	"conditions_version" text NOT NULL,
	"conditions_sha256" text NOT NULL,
	"shop_id" uuid,
	"agreement_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_requests_status_check" CHECK ("listing_requests"."status" IN ('pending', 'accepted', 'refused')),
	CONSTRAINT "listing_requests_person_check" CHECK ("listing_requests"."status" = 'refused' OR ("listing_requests"."signer_name" IS NOT NULL AND "listing_requests"."signer_email" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "shop_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"signer_name" text NOT NULL,
	"signer_email" text NOT NULL,
	"conditions_version" text NOT NULL,
	"conditions_sha256" text NOT NULL,
	"via" text NOT NULL,
	"manage_token_hash" text,
	"admin_id" text,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_agreements_manage_token_hash_unique" UNIQUE("manage_token_hash"),
	CONSTRAINT "shop_agreements_via_check" CHECK ("shop_agreements"."via" IN ('invitation', 'request', 'admin')),
	CONSTRAINT "shop_agreements_withdrawn_check" CHECK (("shop_agreements"."withdrawn_at" IS NULL AND "shop_agreements"."withdrawn_by" IS NULL) OR ("shop_agreements"."withdrawn_at" IS NOT NULL AND "shop_agreements"."withdrawn_by" IN ('signer', 'admin', 'replaced')))
);
--> statement-breakpoint
CREATE TABLE "shop_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"agreement_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "listing_requests" ADD CONSTRAINT "listing_requests_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_requests" ADD CONSTRAINT "listing_requests_agreement_id_shop_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."shop_agreements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_agreements" ADD CONSTRAINT "shop_agreements_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_agreements" ADD CONSTRAINT "shop_agreements_admin_id_user_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_invitations" ADD CONSTRAINT "shop_invitations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_invitations" ADD CONSTRAINT "shop_invitations_agreement_id_shop_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."shop_agreements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_invitations" ADD CONSTRAINT "shop_invitations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listing_requests_status_idx" ON "listing_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_agreements_in_force_idx" ON "shop_agreements" USING btree ("shop_id") WHERE "shop_agreements"."withdrawn_at" IS NULL;--> statement-breakpoint
CREATE INDEX "shop_agreements_shop_idx" ON "shop_agreements" USING btree ("shop_id","accepted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_invitations_open_idx" ON "shop_invitations" USING btree ("shop_id") WHERE "shop_invitations"."revoked_at" IS NULL AND "shop_invitations"."accepted_at" IS NULL;--> statement-breakpoint
-- Added by hand: the agreements ticked by the admin before this migration become the shops' first history line
-- (via 'admin', signer unknown, conditions before v1).
INSERT INTO "shop_agreements" ("shop_id", "accepted_at", "signer_name", "signer_email", "conditions_version", "conditions_sha256", "via")
SELECT "id", "listing_agreement_at", 'Case cochée par l’admin', '', 'avant v1', '', 'admin'
FROM "shops" WHERE "listing_agreement_at" IS NOT NULL;
