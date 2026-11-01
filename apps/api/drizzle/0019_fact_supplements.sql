CREATE TABLE "fact_supplements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"item_key" text,
	"needs_file" boolean NOT NULL,
	"facts" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response_file_ids" jsonb,
	"response_note" text,
	"responded_by" uuid,
	"responded_at" timestamp with time zone,
	"adopted_by" uuid,
	"adopted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "fact_supplements" ADD CONSTRAINT "fact_supplements_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_supplements" ADD CONSTRAINT "fact_supplements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_supplements" ADD CONSTRAINT "fact_supplements_responded_by_users_id_fk" FOREIGN KEY ("responded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_supplements" ADD CONSTRAINT "fact_supplements_adopted_by_users_id_fk" FOREIGN KEY ("adopted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fact_supplements_round" ON "fact_supplements" USING btree ("task_id","round");