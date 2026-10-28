CREATE TABLE "task_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"documents" jsonb NOT NULL,
	"items" jsonb NOT NULL,
	"answers" jsonb NOT NULL,
	"pending_keys" jsonb NOT NULL,
	CONSTRAINT "task_submissions_task_id_unique" UNIQUE("task_id"),
	CONSTRAINT "task_submissions_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;