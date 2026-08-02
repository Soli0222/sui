import {
  basicDeductionNational,
  basicDeductionResident,
  DONATION_DEDUCTION_FLOOR,
  employmentIncome,
  marginalIncomeTaxRate,
  RECOVERY_TAX_COEFFICIENT,
  RESIDENT_TAX_RATE,
} from "./tax-parameters";

export interface FurusatoCoreSalaryRecord {
  paidOn: Date;
  kind: "salary" | "bonus";
  grossAmount: number;
  healthInsurance: number;
  pensionInsurance: number;
  employmentInsurance: number;
}

export interface FurusatoCoreDonation {
  donatedOn: Date;
  amount: number;
}

export interface FurusatoCoreInput {
  year: number;
  salaryRecords: FurusatoCoreSalaryRecord[];
  donations: FurusatoCoreDonation[];
  input: {
    expectedBonusGross: number;
    otherIncome: number;
    otherDeductions: number;
  };
  referenceDate: Date;
}

export interface FurusatoProjection {
  salaryActualGross: number;
  extrapolatedGross: number;
  expectedGrossIncome: number;
  socialInsurance: number;
  employmentIncome: number;
  totalIncome: number;
  taxableIncomeNational: number;
  taxableIncomeResident: number;
  marginalTaxRate: number;
}

export interface FurusatoSimulation {
  year: number;
  input: {
    expectedBonusGross: number;
    otherIncome: number;
    otherDeductions: number;
  };
  projection: FurusatoProjection;
  limit: number;
  donations: {
    total: number;
    remaining: number;
  };
  deduction: {
    incomeTax: number;
    residentBasic: number;
    residentSpecial: number;
    selfBurden: number;
  };
}

function floorTo1000(value: number): number {
  return Math.floor(value / 1000) * 1000;
}

function getMonth(date: Date): number {
  return date.getUTCMonth() + 1;
}

function getSocialInsuranceTotal(record: FurusatoCoreSalaryRecord): number {
  return record.healthInsurance + record.pensionInsurance + record.employmentInsurance;
}

function getLatestSalaryRecord(
  records: FurusatoCoreSalaryRecord[],
): FurusatoCoreSalaryRecord | null {
  const salaryRecords = records.filter((record) => record.kind === "salary");
  if (salaryRecords.length === 0) {
    return null;
  }
  return salaryRecords.sort((left, right) => right.paidOn.getTime() - left.paidOn.getTime())[0];
}

export function calculateFurusatoSimulation({
  year,
  salaryRecords,
  donations,
  input,
}: FurusatoCoreInput): FurusatoSimulation {
  const actualGross = salaryRecords.reduce((sum, record) => sum + record.grossAmount, 0);
  const actualSocialInsurance = salaryRecords.reduce(
    (sum, record) => sum + getSocialInsuranceTotal(record),
    0,
  );
  const latestSalary = getLatestSalaryRecord(salaryRecords);

  const remainingMonths = latestSalary ? 12 - getMonth(latestSalary.paidOn) : 0;
  const extrapolatedGross = latestSalary ? latestSalary.grossAmount * remainingMonths : 0;
  const expectedGrossIncome = actualGross + extrapolatedGross + input.expectedBonusGross;

  const extrapolatedSocialInsurance = latestSalary
    ? getSocialInsuranceTotal(latestSalary) * remainingMonths
    : 0;
  const bonusSocialInsurance =
    latestSalary && latestSalary.grossAmount > 0
      ? Math.floor(input.expectedBonusGross * (getSocialInsuranceTotal(latestSalary) / latestSalary.grossAmount))
      : 0;
  const socialInsurance = actualSocialInsurance + extrapolatedSocialInsurance + bonusSocialInsurance;

  const employmentIncomeAmount = employmentIncome(expectedGrossIncome);
  const totalIncome = employmentIncomeAmount + input.otherIncome;

  const nationalBasicDeduction = basicDeductionNational(totalIncome);
  const residentBasicDeduction = basicDeductionResident(totalIncome);

  const taxableIncomeNational = Math.max(
    0,
    floorTo1000(totalIncome - nationalBasicDeduction - socialInsurance - input.otherDeductions),
  );
  const taxableIncomeResident = Math.max(
    0,
    floorTo1000(totalIncome - residentBasicDeduction - socialInsurance - input.otherDeductions),
  );

  const marginalTaxRate = marginalIncomeTaxRate(taxableIncomeNational);

  const residentTaxIncome = Math.floor(taxableIncomeResident * RESIDENT_TAX_RATE);
  const specialCap = Math.floor(residentTaxIncome * 0.2);

  const denominator = 0.9 - marginalTaxRate * RECOVERY_TAX_COEFFICIENT;
  const limit = Math.floor((residentTaxIncome * 0.2) / denominator) + DONATION_DEDUCTION_FLOOR;

  const donationTotal = donations.reduce((sum, donation) => sum + donation.amount, 0);
  const remaining = Math.max(0, limit - donationTotal);

  let incomeTaxDeduction = 0;
  let residentBasicDeductionAmount = 0;
  let residentSpecialDeductionAmount = 0;

  if (donationTotal > DONATION_DEDUCTION_FLOOR) {
    const taxableDonation = donationTotal - DONATION_DEDUCTION_FLOOR;
    incomeTaxDeduction = Math.floor(taxableDonation * marginalTaxRate * RECOVERY_TAX_COEFFICIENT);
    residentBasicDeductionAmount = Math.floor(taxableDonation * RESIDENT_TAX_RATE);
    residentSpecialDeductionAmount = Math.min(
      Math.floor(taxableDonation * denominator),
      specialCap,
    );
  }

  const selfBurden =
    donationTotal -
    (incomeTaxDeduction + residentBasicDeductionAmount + residentSpecialDeductionAmount);

  return {
    year,
    input: {
      expectedBonusGross: input.expectedBonusGross,
      otherIncome: input.otherIncome,
      otherDeductions: input.otherDeductions,
    },
    projection: {
      salaryActualGross: actualGross,
      extrapolatedGross,
      expectedGrossIncome,
      socialInsurance,
      employmentIncome: employmentIncomeAmount,
      totalIncome,
      taxableIncomeNational,
      taxableIncomeResident,
      marginalTaxRate,
    },
    limit,
    donations: {
      total: donationTotal,
      remaining,
    },
    deduction: {
      incomeTax: incomeTaxDeduction,
      residentBasic: residentBasicDeductionAmount,
      residentSpecial: residentSpecialDeductionAmount,
      selfBurden,
    },
  };
}
