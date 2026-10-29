CREATE TABLE "task_workups" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data" jsonb DEFAULT '{"overrides":{}}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_workups" ADD CONSTRAINT "task_workups_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_workups" ADD CONSTRAINT "task_workups_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;