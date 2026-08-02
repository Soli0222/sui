export const RECOVERY_TAX_COEFFICIENT = 1.021;
export const RESIDENT_TAX_RATE = 0.1;
export const DONATION_DEDUCTION_FLOOR = 2000;

export function employmentIncomeDeduction(r: number): number {
  if (r <= 1_900_000) {
    return 650_000;
  }
  if (r <= 3_600_000) {
    return r * 0.3 + 80_000;
  }
  if (r <= 6_600_000) {
    return r * 0.2 + 440_000;
  }
  if (r <= 8_500_000) {
    return r * 0.1 + 1_100_000;
  }
  return 1_950_000;
}

export function employmentIncome(r: number): number {
  return Math.max(0, r - employmentIncomeDeduction(r));
}

export function basicDeductionNational(a: number): number {
  if (a <= 1_320_000) {
    return 950_000;
  }
  if (a <= 3_360_000) {
    return 880_000;
  }
  if (a <= 4_890_000) {
    return 680_000;
  }
  if (a <= 6_550_000) {
    return 630_000;
  }
  if (a <= 23_500_000) {
    return 580_000;
  }
  if (a <= 24_000_000) {
    return 480_000;
  }
  if (a <= 24_500_000) {
    return 320_000;
  }
  if (a <= 25_000_000) {
    return 160_000;
  }
  return 0;
}

export function basicDeductionResident(a: number): number {
  if (a <= 24_000_000) {
    return 430_000;
  }
  if (a <= 24_500_000) {
    return 290_000;
  }
  if (a <= 25_000_000) {
    return 150_000;
  }
  return 0;
}

export function marginalIncomeTaxRate(t: number): number {
  if (t <= 1_949_000) {
    return 0.05;
  }
  if (t <= 3_299_000) {
    return 0.1;
  }
  if (t <= 6_949_000) {
    return 0.2;
  }
  if (t <= 8_999_000) {
    return 0.23;
  }
  if (t <= 17_999_000) {
    return 0.33;
  }
  if (t <= 39_999_000) {
    return 0.4;
  }
  return 0.45;
}
