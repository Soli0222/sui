-- AuthSession: issuer / email / max_expires_at
ALTER TABLE "auth_sessions" ADD COLUMN "issuer" VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE "auth_sessions" ADD COLUMN "email" VARCHAR(255);
ALTER TABLE "auth_sessions" ADD COLUMN "max_expires_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "auth_sessions" SET "max_expires_at" = "created_at" + INTERVAL '90 days';

-- AuditLog: 主体情報
ALTER TABLE "audit_logs" ADD COLUMN "auth_kind" VARCHAR(20);
ALTER TABLE "audit_logs" ADD COLUMN "subject" VARCHAR(255);
ALTER TABLE "audit_logs" ADD COLUMN "session_id" UUID;
ALTER TABLE "audit_logs" ADD COLUMN "api_token_id" UUID;
ALTER TABLE "audit_logs" ADD COLUMN "auth_mode" VARCHAR(10);
