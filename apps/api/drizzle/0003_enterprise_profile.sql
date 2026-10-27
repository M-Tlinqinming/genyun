ALTER TABLE "enterprises" ADD COLUMN "profile" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "enterprises" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;