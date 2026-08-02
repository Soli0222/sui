CREATE TABLE "donations" (
  "id" UUID NOT NULL,
  "recipient" VARCHAR(100) NOT NULL,
  "amount" INTEGER NOT NULL,
  "memo" VARCHAR(200),
  "donated_on" DATE NOT NULL,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "donations_pkey" PRIMARY KEY ("id")
);
