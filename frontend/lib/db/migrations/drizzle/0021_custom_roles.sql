CREATE TABLE "org_role_permissions" (
	"org_id" text NOT NULL,
	"role_id" uuid NOT NULL,
	"action_id" text NOT NULL,
	"allowed" boolean NOT NULL,
	CONSTRAINT "org_role_permissions_pkey" PRIMARY KEY("role_id","action_id")
);
--> statement-breakpoint
CREATE TABLE "org_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"base_role" text DEFAULT 'org:viewer' NOT NULL,
	"description" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_roles_org_name_key" UNIQUE("org_id","name"),
	CONSTRAINT "org_roles_base_chk" CHECK (base_role = ANY (ARRAY['org:viewer'::text, 'org:editor'::text]))
);
--> statement-breakpoint
ALTER TABLE "org_role_permissions" ADD CONSTRAINT "org_role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."org_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_org_role_permissions_org" ON "org_role_permissions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_org_roles_org_id" ON "org_roles" USING btree ("org_id");