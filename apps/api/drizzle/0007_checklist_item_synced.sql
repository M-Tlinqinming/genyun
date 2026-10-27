ALTER TABLE "checklist_items" ADD COLUMN "synced" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- 本次之前的状态都是自填同步写的（检查页的手动处理此前还没上线）
UPDATE "checklist_items" SET "synced" = true WHERE "note" IS NULL AND "call_requested" = false AND "status" IN ('provided', 'none', 'photo_for_expert');
