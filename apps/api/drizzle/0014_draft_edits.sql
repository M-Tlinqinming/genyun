CREATE TABLE "draft_edits" (
	"batch_id" uuid NOT NULL,
	"kind" "draft_kind" NOT NULL,
	"sections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_edits_batch_id_kind_pk" PRIMARY KEY("batch_id","kind")
);
--> statement-breakpoint
CREATE TABLE "draft_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"save_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"kind" "draft_kind" NOT NULL,
	"section_id" text NOT NULL,
	"section_title" text NOT NULL,
	"note" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"rev" integer NOT NULL,
	"version" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_revisions_save_id_unique" UNIQUE("save_id")
);
--> statement-breakpoint
ALTER TABLE "generated_drafts" ADD COLUMN "document_file_id" uuid;--> statement-breakpoint
ALTER TABLE "draft_edits" ADD CONSTRAINT "draft_edits_batch_id_generation_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."generation_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_edits" ADD CONSTRAINT "draft_edits_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_revisions" ADD CONSTRAINT "draft_revisions_batch_id_generation_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."generation_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_revisions" ADD CONSTRAINT "draft_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "draft_revisions_draft" ON "draft_revisions" USING btree ("batch_id","kind","created_at");--> statement-breakpoint
ALTER TABLE "generated_drafts" ADD CONSTRAINT "generated_drafts_document_file_id_files_id_fk" FOREIGN KEY ("document_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;