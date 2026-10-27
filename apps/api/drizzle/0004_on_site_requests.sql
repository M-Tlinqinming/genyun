CREATE TYPE "public"."call_time" AS ENUM('weekday_morning', 'weekday_afternoon', 'anytime');--> statement-breakpoint
CREATE TYPE "public"."on_site_status" AS ENUM('new', 'handed_over', 'closed');--> statement-breakpoint
CREATE TABLE "on_site_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"enterprise_id" uuid NOT NULL,
	"task_id" uuid,
	"contact_name" text NOT NULL,
	"contact_phone" text NOT NULL,
	"call_time" "call_time",
	"help_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"status" "on_site_status" DEFAULT 'new' NOT NULL,
	"internal_note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "on_site_requests" ADD CONSTRAINT "on_site_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "on_site_requests" ADD CONSTRAINT "on_site_requests_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "on_site_requests" ADD CONSTRAINT "on_site_requests_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "on_site_requests" ADD CONSTRAINT "on_site_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;