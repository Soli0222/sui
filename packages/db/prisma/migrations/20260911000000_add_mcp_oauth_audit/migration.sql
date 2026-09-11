ALTER TABLE "audit_logs"
ADD COLUMN "issuer" TEXT,
ADD COLUMN "oauth_client_id" TEXT;
