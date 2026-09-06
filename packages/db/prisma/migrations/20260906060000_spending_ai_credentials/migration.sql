CREATE TABLE "spending_ai_credentials" (
  "id" INTEGER PRIMARY KEY CHECK ("id" = 1),
  "endpoint" TEXT NOT NULL,
  "encrypted" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL
);
