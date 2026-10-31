CREATE TYPE "public"."draft_kind" AS ENUM('plan', 'risk', 'resource');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
ALTER TYPE "public"."file_kind" ADD VALUE 'draft';--> statement-breakpoint
CREATE TABLE "generated_drafts" (
	"batch_id" uuid NOT NULL,
	"kind" "draft_kind" NOT NULL,
	"status" "draft_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"word_file_id" uuid,
	"pdf_file_id" uuid,
	"error" text,
	"notes" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "generated_drafts_batch_id_kind_pk" PRIMARY KEY("batch_id","kind")
);
--> statement-breakpoint
CREATE TABLE "generation_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"workup_version" integer NOT NULL,
	"snapshot_at" timestamp with time zone NOT NULL,
	"input" jsonb NOT NULL,
	"materials" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generated_drafts" ADD CONSTRAINT "generated_drafts_batch_id_generation_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."generation_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_drafts" ADD CONSTRAINT "generated_drafts_word_file_id_files_id_fk" FOREIGN KEY ("word_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_drafts" ADD CONSTRAINT "generated_drafts_pdf_file_id_files_id_fk" FOREIGN KEY ("pdf_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_batches" ADD CONSTRAINT "generation_batches_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_batches" ADD CONSTRAINT "generation_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_batches_task" ON "generation_batches" USING btree ("task_id","created_at");