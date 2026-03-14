export function getBillingMonthOffset(currentYearMonth: string, targetYearMonth: string) {
  const currentTotalMonths =
    Number(currentYearMonth.slice(0, 4)) * 12 + Number(currentYearMonth.slice(5, 7)) - 1;
  const targetTotalMonths =
    Number(targetYearMonth.slice(0, 4)) * 12 + Number(targetYearMonth.slice(5, 7)) - 1;

  return targetTotalMonths - currentTotalMonths;
}

export function resolveBillingAmount({
  actualAmount,
  assumptionAmount,
  monthOffset,
}: {
  actualAmount: number | null;
  assumptionAmount: number;
  monthOffset: number;
}) {
  if (actualAmount === null) {
    return {
      amount: assumptionAmount,
      sourceType: "assumption" as const,
      safetyValveApplied: false,
    };
  }

  if (monthOffset >= 2 && actualAmount < assumptionAmount) {
    return {
      amount: assumptionAmount,
      sourceType: "safety-valve" as const,
      safetyValveApplied: true,
    };
  }

  return {
    amount: actualAmount,
    sourceType: "actual" as const,
    safetyValveApplied: false,
  };
}
