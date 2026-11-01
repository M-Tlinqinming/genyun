ALTER TABLE "tasks" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
-- 已分派的任务没有接手时间，按提交时间补上（期限本来就从提交起算，结果不变）
UPDATE "tasks" SET "assigned_at" = coalesce("submitted_at", "updated_at") WHERE "assigned_expert_id" IS NOT NULL;
