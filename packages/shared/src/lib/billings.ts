export function isValidYearMonth(value: string): boolean {
  return /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export interface BillingAssumption {
  amount: number;
  startMonth: string | null;
  endMonth: string | null;
}

export function isAssumptionActive(yearMonth: string, period: BillingAssumption): boolean {
  return (period.startMonth === null || yearMonth >= period.startMonth)
    && (period.endMonth === null || yearMonth <= period.endMonth);
}

export function hasOverlappingAssumptions(periods: BillingAssumption[]): boolean {
  return periods.some((left, index) => periods.slice(index + 1).some((right) =>
    (left.endMonth === null || right.startMonth === null || left.endMonth >= right.startMonth)
    && (right.endMonth === null || left.startMonth === null || right.endMonth >= left.startMonth)
  ));
}

export function getBillingMonthOffset(currentYearMonth: string, targetYearMonth: string): number {
  const currentTotalMonths = Number(currentYearMonth.slice(0, 4)) * 12 + Number(currentYearMonth.slice(5, 7)) - 1;
  const targetTotalMonths = Number(targetYearMonth.slice(0, 4)) * 12 + Number(targetYearMonth.slice(5, 7)) - 1;
  return targetTotalMonths - currentTotalMonths;
}

export function resolveBillingAmount({
  actualAmount,
  assumptions,
  yearMonth,
  monthOffset,
}: {
  actualAmount: number | null;
  assumptions: BillingAssumption[];
  yearMonth: string;
  monthOffset: number;
}) {
  const activePeriod = assumptions.find((period) => isAssumptionActive(yearMonth, period));
  const appliedAssumptionAmount = activePeriod?.amount ?? 0;
  if (actualAmount === null) {
    return {
      amount: appliedAssumptionAmount,
      appliedAssumptionAmount,
      sourceType: activePeriod ? "assumption" as const : "none" as const,
      safetyValveApplied: false,
    };
  }
  if (monthOffset >= 1 && actualAmount < appliedAssumptionAmount) {
    return {
      amount: appliedAssumptionAmount,
      appliedAssumptionAmount,
      sourceType: "safety-valve" as const,
      safetyValveApplied: true,
    };
  }
  return {
    amount: actualAmount,
    appliedAssumptionAmount,
    sourceType: "actual" as const,
    safetyValveApplied: false,
  };
}
