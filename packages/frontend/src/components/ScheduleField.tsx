import type { Recurrence } from "@sui/shared";
import { isOneTimeSchedule } from "@sui/shared";
import { useId } from "react";
import { DayOfMonthField, DayOfWeekField } from "./form-fields";
import { FormField } from "./ui/form-field";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { getTodayDate } from "../lib/utils";

export interface ScheduleFieldValue {
  recurrence: Recurrence;
  interval: number;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  startDate: string | null;
  endDate?: string | null;
  oneTime?: boolean;
}

type SchedulePreset = "weekly" | "monthly" | "yearly" | "custom" | "oneTime";

const presetOptions = [
  { value: "weekly", label: "毎週" },
  { value: "monthly", label: "毎月" },
  { value: "yearly", label: "毎年" },
  { value: "custom", label: "カスタム" },
] as const;

const oneTimeOption = { value: "oneTime", label: "単発" } as const;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function getTodayYearMonth() {
  return getTodayDate().slice(0, 7);
}

function updateDateDay(date: string | null, day: number): string {
  const base = date ?? getTodayDate();
  return `${base.slice(0, 7)}-${pad(day)}`;
}

function updateDateMonth(date: string | null, yearMonth: string): string {
  const day = date ? Number(date.slice(8, 10)) : 1;
  return `${yearMonth}-${pad(day)}`;
}

function getPreset(value: ScheduleFieldValue, allowOneTime: boolean): SchedulePreset {
  if (allowOneTime && (value.oneTime || isOneTimeSchedule(value))) {
    return "oneTime";
  }

  if (value.recurrence === "weekly" && value.interval === 1) {
    return "weekly";
  }

  if (value.recurrence === "monthly" && value.interval === 1) {
    return "monthly";
  }

  if (value.recurrence === "monthly" && value.interval === 12) {
    return "yearly";
  }

  return "custom";
}

function defaultCustomInterval(value: ScheduleFieldValue): number {
  if (value.recurrence === "weekly") {
    return value.interval === 1 ? 2 : value.interval;
  }

  return value.interval === 1 || value.interval === 12 ? 2 : value.interval;
}

function defaultDayOfMonth(value: ScheduleFieldValue): number {
  return value.dayOfMonth ?? (value.startDate ? Number(value.startDate.slice(8, 10)) : 1);
}

function defaultDayOfWeek(value: ScheduleFieldValue): number {
  return value.dayOfWeek ?? 0;
}

function defaultOneTimeDate(value: ScheduleFieldValue): string {
  return value.startDate ?? value.endDate ?? getTodayDate();
}

export function ScheduleField({
  id,
  value,
  onChange,
  allowOneTime = false,
}: {
  id?: string;
  value: ScheduleFieldValue;
  onChange: (value: ScheduleFieldValue) => void;
  allowOneTime?: boolean;
}) {
  const generatedId = useId();
  const baseId = id ?? generatedId;
  const preset = getPreset(value, allowOneTime);
  const options = allowOneTime ? [...presetOptions, oneTimeOption] : presetOptions;
  const presetId = `${baseId}-preset`;

  function omitOneTime(value: ScheduleFieldValue): Omit<ScheduleFieldValue, "oneTime"> {
    const { oneTime, ...rest } = value;
    void oneTime;
    return rest;
  }

  function emitChange(next: ScheduleFieldValue, oneTime?: boolean) {
    if (allowOneTime) {
      onChange(oneTime === undefined ? next : { ...next, oneTime });
      return;
    }
    onChange(omitOneTime(next));
  }
  const intervalId = `${baseId}-interval`;
  const unitId = `${baseId}-unit`;
  const dayId = `${baseId}-day`;
  const monthId = `${baseId}-month`;
  const oneTimeDateId = `${baseId}-one-time-date`;

  function handlePresetChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextPreset = event.target.value as SchedulePreset;
    const wasOneTime = value.oneTime || isOneTimeSchedule(value);

    if (nextPreset === "oneTime") {
      const oneTimeDate = defaultOneTimeDate(value);
      const dayOfMonth = Number(oneTimeDate.slice(8, 10));
      const next: ScheduleFieldValue = {
        ...value,
        oneTime: true,
        recurrence: "monthly",
        interval: 1,
        dayOfMonth,
        dayOfWeek: null,
        startDate: oneTimeDate,
        endDate: oneTimeDate,
      };
      emitChange(next);
      return;
    }

    const endDate = wasOneTime ? null : value.endDate;

    if (nextPreset === "weekly") {
      const next: ScheduleFieldValue = {
        ...value,
        oneTime: false,
        recurrence: "weekly",
        interval: 1,
        dayOfMonth: null,
        dayOfWeek: defaultDayOfWeek(value),
        endDate,
      };
      emitChange(next);
      return;
    }

    if (nextPreset === "monthly") {
      const next: ScheduleFieldValue = {
        ...value,
        oneTime: false,
        recurrence: "monthly",
        interval: 1,
        dayOfWeek: null,
        dayOfMonth: defaultDayOfMonth(value),
        endDate,
      };
      emitChange(next);
      return;
    }

    if (nextPreset === "yearly") {
      const startDate = updateDateDay(value.startDate, defaultDayOfMonth(value));
      const dayOfMonth = defaultDayOfMonth(value);
      const next: ScheduleFieldValue = {
        ...value,
        oneTime: false,
        recurrence: "monthly",
        interval: 12,
        dayOfWeek: null,
        dayOfMonth,
        startDate,
        endDate,
      };
      emitChange(next);
      return;
    }

    const isWeekly = value.recurrence === "weekly";
    const interval = defaultCustomInterval(value);
    if (isWeekly) {
      const next: ScheduleFieldValue = {
        ...value,
        oneTime: false,
        recurrence: "weekly",
        interval,
        dayOfMonth: null,
        dayOfWeek: defaultDayOfWeek(value),
        endDate,
      };
      emitChange(next);
    } else {
      const next: ScheduleFieldValue = {
        ...value,
        oneTime: false,
        recurrence: "monthly",
        interval,
        dayOfWeek: null,
        dayOfMonth: defaultDayOfMonth(value),
        endDate,
      };
      emitChange(next);
    }
  }

  function handleOneTimeDateChange(event: React.ChangeEvent<HTMLInputElement>) {
    const date = event.target.value;
    if (date === "") {
      const next: ScheduleFieldValue = {
        ...value,
        oneTime: true,
        recurrence: "monthly",
        interval: 1,
        dayOfMonth: null,
        dayOfWeek: null,
        startDate: null,
        endDate: null,
      };
      emitChange(next);
      return;
    }

    const next: ScheduleFieldValue = {
      ...value,
      oneTime: true,
      recurrence: "monthly",
      interval: 1,
      dayOfMonth: Number(date.slice(8, 10)),
      dayOfWeek: null,
      startDate: date,
      endDate: date,
    };
    emitChange(next);
  }

  function handleDayOfMonthChange(dayOfMonth: number | null) {
    if (dayOfMonth == null) {
      onChange({ ...value, dayOfMonth: null });
      return;
    }

    if (preset === "oneTime" && value.startDate) {
      const startDate = updateDateDay(value.startDate, dayOfMonth);
      onChange({
        ...value,
        dayOfMonth,
        startDate,
        endDate: startDate,
      });
      return;
    }

    if (value.recurrence === "monthly" && value.interval === 12) {
      onChange({ ...value, dayOfMonth, startDate: updateDateDay(value.startDate, dayOfMonth) });
      return;
    }

    onChange({ ...value, dayOfMonth });
  }

  function handleMonthChange(event: React.ChangeEvent<HTMLInputElement>) {
    const yearMonth = event.target.value;
    if (value.recurrence === "monthly" && value.interval === 12 && value.startDate) {
      onChange({ ...value, startDate: updateDateMonth(value.startDate, yearMonth) });
    }
  }

  function handleIntervalChange(event: React.ChangeEvent<HTMLInputElement>) {
    const interval = Number(event.target.value);
    if (Number.isNaN(interval)) {
      return;
    }

    onChange({ ...value, interval: Math.max(1, interval) });
  }

  function handleUnitChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const recurrence = event.target.value as "monthly" | "weekly";
    onChange({
      ...value,
      recurrence,
      dayOfMonth: recurrence === "monthly" ? defaultDayOfMonth(value) : null,
      dayOfWeek: recurrence === "weekly" ? defaultDayOfWeek(value) : null,
    });
  }

  function renderDayInput() {
    if (value.recurrence === "weekly") {
      return (
        <DayOfWeekField
          id={dayId}
          value={value.dayOfWeek}
          onChange={(dayOfWeek) => onChange({ ...value, dayOfWeek })}
          required={false}
        />
      );
    }

    return (
      <DayOfMonthField
        id={dayId}
        value={value.dayOfMonth}
        onChange={handleDayOfMonthChange}
        required={false}
      />
    );
  }

  return (
    <div className="grid gap-4">
      <FormField label="周期" htmlFor={presetId}>
        <Select id={presetId} value={preset} onChange={handlePresetChange}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </FormField>

      {preset === "oneTime" ? (
        <FormField label="予定日" htmlFor={oneTimeDateId} required>
          <Input
            id={oneTimeDateId}
            type="date"
            value={value.startDate ?? ""}
            onChange={handleOneTimeDateChange}
          />
        </FormField>
      ) : null}

      {preset === "yearly" ? (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="開始月" htmlFor={monthId}>
            <Input
              id={monthId}
              type="month"
              value={value.startDate?.slice(0, 7) ?? getTodayYearMonth()}
              onChange={handleMonthChange}
            />
          </FormField>
          {renderDayInput()}
        </div>
      ) : null}

      {preset === "custom" ? (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="間隔" htmlFor={intervalId}>
              <Input
                id={intervalId}
                type="number"
                inputMode="numeric"
                min={1}
                value={value.interval}
                onChange={handleIntervalChange}
              />
            </FormField>
            <FormField label="単位" htmlFor={unitId}>
              <Select id={unitId} value={value.recurrence} onChange={handleUnitChange}>
                <option value="monthly">ヶ月</option>
                <option value="weekly">週</option>
              </Select>
            </FormField>
          </div>
          {renderDayInput()}
        </div>
      ) : null}

      {preset === "monthly" || preset === "weekly" ? renderDayInput() : null}
    </div>
  );
}
