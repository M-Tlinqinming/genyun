CREATE TYPE "public"."business_type" AS ENUM('emergency_plan');--> statement-breakpoint
CREATE TYPE "public"."expert_result" AS ENUM('pending', 'yes', 'no');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('provided', 'none', 'later', 'photo_for_expert');--> statement-breakpoint
CREATE TYPE "public"."start_method" AS ENUM('self_fill', 'upload');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('preparing', 'submitted');--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"task_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"status" "item_status" NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"call_requested" boolean DEFAULT false NOT NULL,
	"expert_result" "expert_result",
	"expert_judged_by" uuid,
	"expert_judged_at" timestamp with time zone,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_items_task_id_item_key_pk" PRIMARY KEY("task_id","item_key")
);
--> statement-breakpoint
CREATE TABLE "enterprises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"social_credit_code" text,
	"registered_address" text,
	"legal_representative" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_number_counters" (
	"year" integer PRIMARY KEY NOT NULL,
	"last" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"enterprise_id" uuid NOT NULL,
	"number" text NOT NULL,
	"business_type" "business_type" NOT NULL,
	"name" text NOT NULL,
	"start_method" "start_method",
	"status" "task_status" DEFAULT 'preparing' NOT NULL,
	"assigned_expert_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "tasks_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "contract_starts_at" date;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "contract_ends_at" date;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_expert_judged_by_users_id_fk" FOREIGN KEY ("expert_judged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprises" ADD CONSTRAINT "enterprises_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprises" ADD CONSTRAINT "enterprises_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_expert_id_users_id_fk" FOREIGN KEY ("assigned_expert_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enterprises_org_credit_code_unique" ON "enterprises" USING btree ("org_id","social_credit_code") WHERE "enterprises"."social_credit_code" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_one_open_per_enterprise" ON "tasks" USING btree ("enterprise_id","business_type") WHERE "tasks"."closed_at" is null;--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "service_ends_at";