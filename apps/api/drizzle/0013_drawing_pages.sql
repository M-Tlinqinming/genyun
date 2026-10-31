CREATE TABLE "drawing_pages" (
	"file_id" uuid NOT NULL,
	"page" integer NOT NULL,
	"full_key" text NOT NULL,
	"full_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"thumb_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drawing_pages_file_id_page_pk" PRIMARY KEY("file_id","page")
);
--> statement-breakpoint
CREATE TABLE "drawing_sources" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"page_count" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drawing_pages" ADD CONSTRAINT "drawing_pages_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawing_sources" ADD CONSTRAINT "drawing_sources_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;