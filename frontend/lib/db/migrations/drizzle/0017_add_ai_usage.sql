CREATE TABLE "ai_usage" (
	"org_id" text NOT NULL,
	"period_start" date NOT NULL,
	"model" text NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_org_id_period_start_model_pk" PRIMARY KEY("org_id","period_start","model")
);
