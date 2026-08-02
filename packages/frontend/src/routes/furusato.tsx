import { useState } from "react";
import { DonationLog } from "../components/donation-log";
import { FurusatoSimulation } from "../components/furusato-simulation";
import { getCurrentYearMonth } from "../lib/utils";

export function FurusatoPage() {
  const [year, setYear] = useState(getCurrentYearMonth().slice(0, 4));

  return (
    <div className="grid gap-6">
      <FurusatoSimulation year={year} onYearChange={setYear} />
      <DonationLog selectedYear={year} onYearChange={setYear} />
    </div>
  );
}
