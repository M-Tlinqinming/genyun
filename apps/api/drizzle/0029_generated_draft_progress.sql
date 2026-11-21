ALTER TABLE "generated_drafts" ADD COLUMN "progress" jsonb;--> statement-breakpoint
ALTER TABLE "generated_drafts" ADD COLUMN "queued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generated_drafts" ADD COLUMN "pages" integer;--> statement-breakpoint
ALTER TABLE "generated_drafts" ADD COLUMN "pending_count" integer;