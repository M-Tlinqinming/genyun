CREATE TABLE "task_reopens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"reopened_by" uuid,
	"reopened_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_reopens_delivery_id_unique" UNIQUE("delivery_id")
);
--> statement-breakpoint
ALTER TABLE "draft_previews" ADD COLUMN "pages" integer;--> statement-breakpoint
ALTER TABLE "task_reopens" ADD CONSTRAINT "task_reopens_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reopens" ADD CONSTRAINT "task_reopens_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reopens" ADD CONSTRAINT "task_reopens_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_reopens_task" ON "task_reopens" USING btree ("task_id");