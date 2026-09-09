-- Authored by `drizzle-kit generate` from src/schema, then reviewed.
-- drizzle-kit never applies migrations here; see drizzle.config.ts.

CREATE TABLE "shopify_installs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"shop" text NOT NULL,
	"state" text,
	"is_online" boolean DEFAULT false NOT NULL,
	"scope" text,
	"expires" timestamp with time zone,
	"access_token_ciphertext" text,
	"access_token_iv" text,
	"access_token_tag" text,
	"encryption_key_version" integer DEFAULT 1 NOT NULL,
	"online_access_info" jsonb,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uninstalled_at" timestamp with time zone
);

CREATE TABLE "tenant_config" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"brand_name" text NOT NULL,
	"brand_description" text,
	"brand_voice" text NOT NULL,
	"languages" text[] DEFAULT '{en}' NOT NULL,
	"enabled_channels" text[] DEFAULT '{web}' NOT NULL,
	"chat_model" text NOT NULL,
	"embedding_model" text NOT NULL,
	"reranker" text DEFAULT 'fusion' NOT NULL,
	"production_chat_model" text,
	"escalation_emails" text[] DEFAULT '{}' NOT NULL,
	"business_hours" jsonb,
	"policy_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retrieval_min_score" real DEFAULT 0.35 NOT NULL,
	"retention_days" integer DEFAULT 90 NOT NULL,
	"max_tokens_per_conversation" integer DEFAULT 60000 NOT NULL,
	"max_turns_per_conversation" integer DEFAULT 25 NOT NULL,
	"max_tokens_per_day" bigint DEFAULT 5000000 NOT NULL,
	"usage_alert_pct" integer DEFAULT 70 NOT NULL,
	"max_escalations_per_hour" integer DEFAULT 20 NOT NULL,
	"data_region" text DEFAULT 'eu-central-1' NOT NULL,
	"anonymise_on_expiry" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_config_retention_check" CHECK ("tenant_config"."retention_days" in (30, 90, 365)),
	CONSTRAINT "tenant_config_alert_pct_check" CHECK ("tenant_config"."usage_alert_pct" between 1 and 99)
);

CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"shopify_domain" text,
	"widget_public_key" text NOT NULL,
	"plan" text DEFAULT 'pilot' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_status_check" CHECK ("tenants"."status" in ('active','suspended','archived'))
);

CREATE TABLE "chunk_embeddings" (
	"chunk_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding_dims" integer NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chunk_embeddings_chunk_id_embedding_model_pk" PRIMARY KEY("chunk_id","embedding_model"),
	CONSTRAINT "chunk_embeddings_dims_check" CHECK ("chunk_embeddings"."embedding_dims" = 1536)
);

CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"heading_path" text[] DEFAULT '{}' NOT NULL,
	"url" text,
	"lang" text NOT NULL,
	"token_count" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"url" text,
	"title" text,
	"lang" text NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_lang_check" CHECK ("documents"."lang" in ('en','ar')),
	CONSTRAINT "documents_source_type_check" CHECK ("documents"."source_type" in ('product','collection','page','article','policy','upload'))
);

CREATE TABLE "knowledge_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"question_norm" text NOT NULL,
	"question_sample" text NOT NULL,
	"lang" text NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"best_score" real,
	"status" text DEFAULT 'open' NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_gaps_status_check" CHECK ("knowledge_gaps"."status" in ('open','answered','dismissed'))
);

CREATE TABLE "conversation_tombstones" (
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_tombstones_tenant_id_conversation_id_pk" PRIMARY KEY("tenant_id","conversation_id")
);

CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"external_id" text NOT NULL,
	"customer_ref" text,
	"lang" text,
	"status" text DEFAULT 'open' NOT NULL,
	"outcome" text,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"token_total" bigint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "conversations_channel_check" CHECK ("conversations"."channel" in ('web','instagram','whatsapp')),
	CONSTRAINT "conversations_status_check" CHECK ("conversations"."status" in ('open','escalated','resolved','closed')),
	CONSTRAINT "conversations_outcome_check" CHECK ("conversations"."outcome" is null or "conversations"."outcome" in ('deflected','escalated','abandoned'))
);

CREATE TABLE "escalation_digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"escalation_count" integer NOT NULL,
	"sent_to" text[] DEFAULT '{}' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"summary" text,
	"contact" jsonb,
	"sent_to" text[] DEFAULT '{}' NOT NULL,
	"delivery_status" text DEFAULT 'pending' NOT NULL,
	"digest_id" uuid,
	"sent_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "escalations_delivery_status_check" CHECK ("escalations"."delivery_status" in ('pending','sent','digested','failed'))
);

CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text,
	"tool_calls" jsonb,
	"retrieval_hits" jsonb,
	"grounding" jsonb,
	"model" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_role_check" CHECK ("messages"."role" in ('system','user','assistant','tool'))
);

CREATE TABLE "order_lookup_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid,
	"ip_hash" text,
	"order_number_hash" text,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_lookup_attempts_outcome_check" CHECK ("order_lookup_attempts"."outcome" in ('match','mismatch','not_found','rate_limited'))
);

CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"git_sha" text NOT NULL,
	"suite" text NOT NULL,
	"tier" text NOT NULL,
	"chat_model" text NOT NULL,
	"embedding_model" text NOT NULL,
	"reranker" text NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"accuracy" real,
	"deflection_rate" real,
	"escalation_precision" real,
	"retrieval_hit_rate" real,
	"p95_latency_ms" integer,
	"cost_per_conversation_usd" numeric(12, 6),
	"hallucination_count" integer,
	"citation_miss_count" integer,
	"policy_accuracy_sampled" real,
	"policy_sample_size" integer,
	"policy_sample_reviewed_by" text,
	"policy_sample_reviewed_at" timestamp with time zone,
	"meets_ship_bar" boolean DEFAULT false NOT NULL,
	"ship_bar_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_runs_tier_check" CHECK ("eval_runs"."tier" in ('provisional','validated'))
);

CREATE TABLE "usage_daily" (
	"tenant_id" uuid NOT NULL,
	"day" date NOT NULL,
	"channel" text NOT NULL,
	"prompt_tokens" bigint DEFAULT 0 NOT NULL,
	"completion_tokens" bigint DEFAULT 0 NOT NULL,
	"llm_calls" integer DEFAULT 0 NOT NULL,
	"conversations" integer DEFAULT 0 NOT NULL,
	"escalations" integer DEFAULT 0 NOT NULL,
	"model_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"meta_message_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"meta_billable_messages" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_daily_tenant_id_day_channel_pk" PRIMARY KEY("tenant_id","day","channel")
);

ALTER TABLE "shopify_installs" ADD CONSTRAINT "shopify_installs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "tenant_config" ADD CONSTRAINT "tenant_config_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chunk_embeddings" ADD CONSTRAINT "chunk_embeddings_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chunk_embeddings" ADD CONSTRAINT "chunk_embeddings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "conversation_tombstones" ADD CONSTRAINT "conversation_tombstones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "escalation_digests" ADD CONSTRAINT "escalation_digests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_digest_id_escalation_digests_id_fk" FOREIGN KEY ("digest_id") REFERENCES "public"."escalation_digests"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "order_lookup_attempts" ADD CONSTRAINT "order_lookup_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "order_lookup_attempts" ADD CONSTRAINT "order_lookup_attempts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "shopify_installs_shop_online_key" ON "shopify_installs" USING btree ("shop","is_online");
CREATE UNIQUE INDEX "tenants_shopify_domain_key" ON "tenants" USING btree ("shopify_domain");
CREATE UNIQUE INDEX "tenants_widget_public_key_key" ON "tenants" USING btree ("widget_public_key");
CREATE UNIQUE INDEX "chunks_document_ordinal_key" ON "chunks" USING btree ("document_id","ordinal");
CREATE INDEX "chunks_tenant_lang_idx" ON "chunks" USING btree ("tenant_id","lang");
CREATE UNIQUE INDEX "documents_source_key" ON "documents" USING btree ("tenant_id","source_type","source_id");
CREATE INDEX "documents_tenant_lang_idx" ON "documents" USING btree ("tenant_id","lang");
CREATE UNIQUE INDEX "knowledge_gaps_norm_key" ON "knowledge_gaps" USING btree ("tenant_id","lang","question_norm");
CREATE INDEX "knowledge_gaps_tenant_status_idx" ON "knowledge_gaps" USING btree ("tenant_id","status","occurrences");
CREATE UNIQUE INDEX "conversations_external_key" ON "conversations" USING btree ("tenant_id","channel","external_id");
CREATE INDEX "conversations_tenant_status_idx" ON "conversations" USING btree ("tenant_id","status","last_message_at");
CREATE INDEX "escalations_tenant_created_idx" ON "escalations" USING btree ("tenant_id","created_at");
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");
CREATE INDEX "messages_tenant_created_idx" ON "messages" USING btree ("tenant_id","created_at");
CREATE INDEX "order_lookup_attempts_tenant_idx" ON "order_lookup_attempts" USING btree ("tenant_id","created_at");
CREATE INDEX "order_lookup_attempts_ip_idx" ON "order_lookup_attempts" USING btree ("ip_hash","created_at");
CREATE INDEX "eval_runs_tenant_created_idx" ON "eval_runs" USING btree ("tenant_id","created_at");
CREATE INDEX "usage_daily_day_idx" ON "usage_daily" USING btree ("day");