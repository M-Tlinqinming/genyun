ALTER TYPE "public"."file_kind" ADD VALUE 'delivery';--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publish_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"reviewed_by" uuid NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"versions" jsonb NOT NULL,
	"published_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "deliveries_publish_id_unique" UNIQUE("publish_id")
);
--> statement-breakpoint
CREATE TABLE "delivery_files" (
	"delivery_id" uuid NOT NULL,
	"kind" "draft_kind" NOT NULL,
	"file_id" uuid NOT NULL,
	CONSTRAINT "delivery_files_delivery_id_kind_pk" PRIMARY KEY("delivery_id","kind")
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_batch_id_generation_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."generation_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_files" ADD CONSTRAINT "delivery_files_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_files" ADD CONSTRAINT "delivery_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_task_version" ON "deliveries" USING btree ("task_id","version") WHERE "deliveries"."status" = 'done';--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_one_publishing" ON "deliveries" USING btree ("task_id") WHERE "deliveries"."status" = 'publishing';--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_batch_once" ON "deliveries" USING btree ("batch_id") WHERE "deliveries"."status" <> 'failed';