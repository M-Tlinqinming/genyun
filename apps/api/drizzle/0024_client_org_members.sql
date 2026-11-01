CREATE TABLE "enterprise_assignments" (
	"enterprise_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enterprise_assignments_enterprise_id_user_id_pk" PRIMARY KEY("enterprise_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "enterprises" ADD COLUMN "members_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_reason" text;--> statement-breakpoint
-- 迁移前停用的都是运营在内部账号里停用的
UPDATE "users" SET "disabled_reason" = 'operator' WHERE "disabled_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "enterprise_assignments" ADD CONSTRAINT "enterprise_assignments_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_assignments" ADD CONSTRAINT "enterprise_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_assignments" ADD CONSTRAINT "enterprise_assignments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_assignments" ADD CONSTRAINT "enterprise_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enterprise_assignments_user" ON "enterprise_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_dedupe" ON "notifications" USING btree ("user_id","dedupe_key") WHERE "notifications"."dedupe_key" is not null;