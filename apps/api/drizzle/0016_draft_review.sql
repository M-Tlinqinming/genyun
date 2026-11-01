CREATE TABLE "draft_checks" (
	"batch_id" uuid NOT NULL,
	"kind" "draft_kind" NOT NULL,
	"version" integer NOT NULL,
	"checked_by" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_checks_batch_id_kind_pk" PRIMARY KEY("batch_id","kind")
);
--> statement-breakpoint
CREATE TABLE "draft_previews" (
	"batch_id" uuid NOT NULL,
	"kind" "draft_kind" NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"file_id" uuid,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_previews_batch_id_kind_pk" PRIMARY KEY("batch_id","kind")
);
--> statement-breakpoint
CREATE TABLE "draft_reviews" (
	"batch_id" uuid PRIMARY KEY NOT NULL,
	"note" text NOT NULL,
	"versions" jsonb NOT NULL,
	"reviewed_by" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "draft_checks" ADD CONSTRAINT "draft_checks_batch_id_generation_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."generation_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_checks" ADD CONSTRAINT "draft_checks_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_previews" ADD CONSTRAINT "draft_previews_batch_id_generation_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."generation_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_previews" ADD CONSTRAINT "draft_previews_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_reviews" ADD CONSTRAINT "draft_reviews_batch_id_generation_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."generation_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_reviews" ADD CONSTRAINT "draft_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;