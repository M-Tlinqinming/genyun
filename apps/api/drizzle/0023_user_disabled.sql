ALTER TABLE "users" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
-- 老数据里同一组织同一邮箱若有多封未接受、未作废的邀请，只留最新一封，其余记为作废，再建唯一索引
UPDATE "organization_invitations" AS o SET "revoked_at" = now()
WHERE o."accepted_at" IS NULL AND o."revoked_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "organization_invitations" AS n
    WHERE n."org_id" = o."org_id" AND n."email" = o."email"
      AND n."accepted_at" IS NULL AND n."revoked_at" IS NULL
      AND (n."created_at", n."id") > (o."created_at", o."id")
  );--> statement-breakpoint
CREATE UNIQUE INDEX "organization_invitations_open_email" ON "organization_invitations" USING btree ("org_id","email") WHERE "organization_invitations"."accepted_at" is null and "organization_invitations"."revoked_at" is null;