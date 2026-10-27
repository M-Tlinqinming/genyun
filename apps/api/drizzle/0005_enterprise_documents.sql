CREATE TABLE "enterprise_document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"file_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enterprise_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"enterprise_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_documents" (
	"task_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"linked_by" uuid NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_documents_task_id_document_id_pk" PRIMARY KEY("task_id","document_id")
);
--> statement-breakpoint
ALTER TABLE "enterprise_document_versions" ADD CONSTRAINT "enterprise_document_versions_document_id_enterprise_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."enterprise_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_document_versions" ADD CONSTRAINT "enterprise_document_versions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_document_versions" ADD CONSTRAINT "enterprise_document_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_documents" ADD CONSTRAINT "enterprise_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_documents" ADD CONSTRAINT "enterprise_documents_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_documents" ADD CONSTRAINT "enterprise_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_document_id_enterprise_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."enterprise_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_version_id_enterprise_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."enterprise_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enterprise_document_versions_number" ON "enterprise_document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "enterprise_document_versions_file" ON "enterprise_document_versions" USING btree ("file_id");