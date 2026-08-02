CREATE TYPE "SalaryRecordKind" AS ENUM ('salary', 'bonus');

CREATE TABLE "salary_records" (
  "id" UUID NOT NULL,
  "paid_on" DATE NOT NULL,
  "kind" "SalaryRecordKind" NOT NULL DEFAULT 'salary',
  "name" VARCHAR(100),
  "gross_amount" INTEGER NOT NULL,
  "health_insurance" INTEGER NOT NULL DEFAULT 0,
  "pension_insurance" INTEGER NOT NULL DEFAULT 0,
  "employment_insurance" INTEGER NOT NULL DEFAULT 0,
  "income_tax" INTEGER NOT NULL DEFAULT 0,
  "resident_tax" INTEGER NOT NULL DEFAULT 0,
  "other_deductions" INTEGER NOT NULL DEFAULT 0,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "salary_records_pkey" PRIMARY KEY ("id")
);
