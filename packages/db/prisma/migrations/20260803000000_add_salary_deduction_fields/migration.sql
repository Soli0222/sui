ALTER TABLE "salary_records"
  ADD COLUMN "childcare_support_levy" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "employee_stock_contribution" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "employee_stock_incentive" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "dc_matching_contribution" INTEGER NOT NULL DEFAULT 0;
