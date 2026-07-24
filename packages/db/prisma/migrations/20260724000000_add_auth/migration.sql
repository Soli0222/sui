CREATE TABLE "auth_sessions" (
  "id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "subject" VARCHAR(255) NOT NULL,
  "user_agent" VARCHAR(255),
  "expires_at" TIMESTAMP(3) NOT NULL,
  "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

CREATE TABLE "api_tokens" (
  "id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "token_hash" TEXT NOT NULL,
  "read_only" BOOLEAN NOT NULL DEFAULT false,
  "last_used_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens"("token_hash");
