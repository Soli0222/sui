CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "method" VARCHAR(10) NOT NULL,
  "path" VARCHAR(300) NOT NULL,
  "status" INTEGER NOT NULL,
  "client_source" VARCHAR(20) NOT NULL,
  "request_id" VARCHAR(40),
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");
