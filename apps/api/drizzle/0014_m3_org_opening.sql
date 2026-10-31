CREATE TYPE "public"."service_scope_kind" AS ENUM('single', 'annual');--> statement-breakpoint
CREATE TABLE "organization_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"scope_kind" "service_scope_kind" NOT NULL,
	"scope_enterprises" integer,
	"starts_at" date NOT NULL,
	"ends_at" date NOT NULL,
	"file_id" uuid NOT NULL,
	"payment_confirmed_by" uuid NOT NULL,
	"payment_confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"invited_by" uuid NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "social_credit_code" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "contact_name" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "registered_by" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "activated_by" uuid;--> statement-breakpoint
ALTER TABLE "organization_contracts" ADD CONSTRAINT "organization_contracts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_contracts" ADD CONSTRAINT "organization_contracts_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_contracts" ADD CONSTRAINT "organization_contracts_payment_confirmed_by_users_id_fk" FOREIGN KEY ("payment_confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_invitations_org" ON "organization_invitations" USING btree ("org_id");--> statement-breakpoint
-- M3 之前建的客户组织（演示数据、预览环境）已登记合同有效期，视为已开通
UPDATE "organizations" SET "activated_at" = "created_at" WHERE "kind" = 'customer' AND "contract_starts_at" IS NOT NULL;