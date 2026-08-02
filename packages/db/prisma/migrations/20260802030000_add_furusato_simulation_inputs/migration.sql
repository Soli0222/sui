CREATE TABLE "furusato_simulation_inputs" (
  "id" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "expected_bonus_gross" INTEGER NOT NULL DEFAULT 0,
  "other_income" INTEGER NOT NULL DEFAULT 0,
  "other_deductions" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "furusato_simulation_inputs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "furusato_simulation_inputs_year_key" ON "furusato_simulation_inputs"("year");
