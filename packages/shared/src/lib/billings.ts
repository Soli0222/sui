export function isValidYearMonth(value: string): boolean {
  return /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isAssumptionActive(
  yearMonth: string,
  assumptionStartMonth: string | null,
  assumptionEndMonth: string | null,
): boolean {
  return (assumptionStartMonth === null || yearMonth >= assumptionStartMonth)
    && (assumptionEndMonth === null || yearMonth <= assumptionEndMonth);
}

export function getBillingMonthOffset(currentYearMonth: string, targetYearMonth: string): number {
  const currentTotalMonths = Number(currentYearMonth.slice(0, 4)) * 12 + Number(currentYearMonth.slice(5, 7)) - 1;
  const targetTotalMonths = Number(targetYearMonth.slice(0, 4)) * 12 + Number(targetYearMonth.slice(5, 7)) - 1;
  return targetTotalMonths - currentTotalMonths;
}

export function resolveBillingAmount({
  actualAmount,
  assumptionAmount,
  assumptionStartMonth,
  assumptionEndMonth,
  yearMonth,
  monthOffset,
}: {
  actualAmount: number | null;
  assumptionAmount: number;
  assumptionStartMonth: string | null;
  assumptionEndMonth: string | null;
  yearMonth: string;
  monthOffset: number;
}) {
  const active = isAssumptionActive(yearMonth, assumptionStartMonth, assumptionEndMonth);
  const appliedAssumptionAmount = active
    ? assumptionAmount : 0;
  if (actualAmount === null) {
    return {
      amount: appliedAssumptionAmount,
      appliedAssumptionAmount,
      sourceType: active ? "assumption" as const : "none" as const,
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
