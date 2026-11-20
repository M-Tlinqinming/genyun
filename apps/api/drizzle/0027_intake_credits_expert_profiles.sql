CREATE TYPE "public"."charge_status" AS ENUM('not_charged', 'charged', 'awaiting_credits');--> statement-breakpoint
CREATE TYPE "public"."credit_entry_type" AS ENUM('contract_purchase', 'top_up', 'gift', 'compensation', 'delivery_deduction');--> statement-breakpoint
CREATE TYPE "public"."credit_pool" AS ENUM('gift', 'purchase');--> statement-breakpoint
CREATE TYPE "public"."expert_avatar" AS ENUM('gy1', 'gy2', 'gy3', 'gy4', 'gy5', 'gy6', 'gy7', 'gy8');--> statement-breakpoint
CREATE TYPE "public"."expert_review_status" AS ENUM('pending', 'approved', 'rejected', 'delisted');--> statement-breakpoint
CREATE TYPE "public"."intake_file_slot" AS ENUM('data_sheet', 'site_plan', 'evacuation_map', 'other');--> statement-breakpoint
CREATE TYPE "public"."intake_uploader_side" AS ENUM('customer', 'expert');--> statement-breakpoint
ALTER TYPE "public"."file_kind" ADD VALUE 'expert_certificate';--> statement-breakpoint
CREATE TABLE "credit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"type" "credit_entry_type" NOT NULL,
	"delta" integer NOT NULL,
	"campaign" text,
	"contract_id" uuid,
	"task_id" uuid,
	"delivery_id" uuid,
	"pool" "credit_pool",
	"reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expert_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"avatar" "expert_avatar",
	"display_name" text NOT NULL,
	"years_of_experience" integer,
	"industries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"intro" text,
	"bio" text,
	"real_name" text,
	"certificates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"certificate_expires_on" date,
	"review_status" "expert_review_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"accepting_orders" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_intake_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"slot" "intake_file_slot" NOT NULL,
	"file_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploaded_by_expert" boolean DEFAULT false NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_intake_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_by" uuid,
	"withdrawn_at" timestamp with time zone,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "task_intake_submissions_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "task_intakes" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"data_sheet_file_id" uuid,
	"template_version" text,
	"parse_result" jsonb,
	"required_check" jsonb,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"no_evacuation_map" boolean DEFAULT false NOT NULL,
	"preferred_expert_id" uuid,
	"last_uploaded_side" "intake_uploader_side",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
DROP INDEX "deliveries_batch_once";--> statement-breakpoint
DROP INDEX "tasks_one_open_per_enterprise";--> statement-breakpoint
ALTER TABLE "organization_contracts" ALTER COLUMN "scope_kind" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_contracts" ALTER COLUMN "file_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "update_note" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "awaiting_customer_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "awaiting_customer_items" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "charge_status" charge_status DEFAULT 'not_charged' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_contract_id_organization_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."organization_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_profiles" ADD CONSTRAINT "expert_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expert_profiles" ADD CONSTRAINT "expert_profiles_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_intake_files" ADD CONSTRAINT "task_intake_files_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_intake_files" ADD CONSTRAINT "task_intake_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_intake_files" ADD CONSTRAINT "task_intake_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_intake_submissions" ADD CONSTRAINT "task_intake_submissions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_intake_submissions" ADD CONSTRAINT "task_intake_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_intake_submissions" ADD CONSTRAINT "task_intake_submissions_withdrawn_by_users_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_intakes" ADD CONSTRAINT "task_intakes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_intakes" ADD CONSTRAINT "task_intakes_data_sheet_file_id_files_id_fk" FOREIGN KEY ("data_sheet_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_intakes" ADD CONSTRAINT "task_intakes_preferred_expert_id_users_id_fk" FOREIGN KEY ("preferred_expert_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_intakes" ADD CONSTRAINT "task_intakes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_entries_org" ON "credit_entries" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_entries_one_deduction_per_task" ON "credit_entries" USING btree ("task_id") WHERE "credit_entries"."type" = 'delivery_deduction';--> statement-breakpoint
CREATE INDEX "task_intake_files_task" ON "task_intake_files" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_intake_files_one_data_sheet" ON "task_intake_files" USING btree ("task_id") WHERE "task_intake_files"."slot" = 'data_sheet' and "task_intake_files"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "task_intake_submissions_one_active" ON "task_intake_submissions" USING btree ("task_id") WHERE "task_intake_submissions"."withdrawn_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "task_intake_submissions_one_withdrawn" ON "task_intake_submissions" USING btree ("task_id") WHERE "task_intake_submissions"."withdrawn_at" is not null;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deliveries_batch" ON "deliveries" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_one_open_per_enterprise" ON "tasks" USING btree ("enterprise_id","business_type") WHERE "tasks"."closed_at" is null and "tasks"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_update_note_length" CHECK (char_length("deliveries"."update_note") <= 40);