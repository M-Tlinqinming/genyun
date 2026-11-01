CREATE TYPE "public"."operator_note_kind" AS ENUM('note', 'remind_expert', 'reassign');--> statement-breakpoint
CREATE TABLE "task_operator_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" "operator_note_kind" NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_operator_notes" ADD CONSTRAINT "task_operator_notes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_operator_notes" ADD CONSTRAINT "task_operator_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_operator_notes_task" ON "task_operator_notes" USING btree ("task_id","created_at");