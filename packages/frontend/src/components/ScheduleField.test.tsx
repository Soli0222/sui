import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { ScheduleField, type ScheduleFieldValue } from "./ScheduleField";

afterEach(() => {
  cleanup();
});

const defaultValue: ScheduleFieldValue = {
  recurrence: "monthly",
  interval: 1,
  dayOfMonth: 1,
  dayOfWeek: null,
  startDate: null,
  endDate: null,
  oneTime: false,
};

function StatefulScheduleField({
  initialValue,
  allowOneTime = false,
  onChange,
}: {
  initialValue: ScheduleFieldValue;
  allowOneTime?: boolean;
  onChange?: (value: ScheduleFieldValue) => void;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <ScheduleField
      value={value}
      allowOneTime={allowOneTime}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe("ScheduleField", () => {
  it("サブスク用の場合は周期 select に「単発」が含まれない", () => {
    render(<StatefulScheduleField initialValue={defaultValue} />);
    const select = screen.getByLabelText("周期") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).not.toContain("oneTime");
  });

  it("予定収支用は「単発」を選ぶと oneTime フラグと startDate/endDate が同じ日付になる", () => {
    const onChange = vi.fn();
    render(<StatefulScheduleField initialValue={defaultValue} allowOneTime onChange={onChange} />);

    const select = screen.getByLabelText("周期") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "oneTime" } });

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      oneTime: true,
      recurrence: "monthly",
      interval: 1,
      dayOfWeek: null,
      startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }));

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as ScheduleFieldValue;
    expect(lastCall.startDate).toBe(lastCall.endDate);
    expect(lastCall.dayOfMonth).toBe(Number(lastCall.startDate?.slice(8, 10)));
  });

  it("単発を選んだあと予定日を消しても oneTime 状態が解除されない", () => {
    const onChange = vi.fn();
    const initial: ScheduleFieldValue = {
      ...defaultValue,
      oneTime: true,
      recurrence: "monthly",
      interval: 1,
      dayOfMonth: 15,
      dayOfWeek: null,
      startDate: "2026-09-15",
      endDate: "2026-09-15",
    };

    render(<StatefulScheduleField initialValue={initial} allowOneTime onChange={onChange} />);

    const dateInput = screen.getByLabelText("予定日", { exact: false }) as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "" } });

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as ScheduleFieldValue;
    expect(lastCall.oneTime).toBe(true);
    expect(lastCall.startDate).toBeNull();
    expect(lastCall.endDate).toBeNull();
    expect(lastCall.dayOfMonth).toBeNull();
  });

  it("単発で日付が空欄のとき保存は不可（dayOfMonth が null となる）", () => {
    const onChange = vi.fn();
    const initial: ScheduleFieldValue = {
      ...defaultValue,
      oneTime: true,
      recurrence: "monthly",
      interval: 1,
      dayOfMonth: null,
      dayOfWeek: null,
      startDate: null,
      endDate: null,
    };

    render(<StatefulScheduleField initialValue={initial} allowOneTime onChange={onChange} />);

    const dateInput = screen.getByLabelText("予定日", { exact: false }) as HTMLInputElement;
    expect(dateInput.value).toBe("");

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as ScheduleFieldValue | undefined;
    if (lastCall) {
      expect(lastCall.dayOfMonth).toBeNull();
      expect(lastCall.startDate).toBeNull();
    }
  });

  it("単発から毎月に切り替えると endDate がクリアされる", () => {
    const onChange = vi.fn();
    const initial: ScheduleFieldValue = {
      ...defaultValue,
      oneTime: true,
      recurrence: "monthly",
      interval: 1,
      dayOfMonth: 15,
      dayOfWeek: null,
      startDate: "2026-09-15",
      endDate: "2026-09-15",
    };

    render(<StatefulScheduleField initialValue={initial} allowOneTime onChange={onChange} />);

    const select = screen.getByLabelText("周期") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "monthly" } });

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as ScheduleFieldValue;
    expect(lastCall.oneTime).toBe(false);
    expect(lastCall.endDate).toBeNull();
    expect(lastCall.dayOfMonth).toBe(15);
  });

  it("単発の予定日を変更すると startDate と endDate が新しい日付に同期する", () => {
    const onChange = vi.fn();
    const initial: ScheduleFieldValue = {
      ...defaultValue,
      oneTime: true,
      recurrence: "monthly",
      interval: 1,
      dayOfMonth: 15,
      dayOfWeek: null,
      startDate: "2026-09-15",
      endDate: "2026-09-15",
    };

    render(<StatefulScheduleField initialValue={initial} allowOneTime onChange={onChange} />);

    const dateInput = screen.getByLabelText("予定日", { exact: false }) as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-10-20" } });

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as ScheduleFieldValue;
    expect(lastCall.startDate).toBe("2026-10-20");
    expect(lastCall.endDate).toBe("2026-10-20");
    expect(lastCall.dayOfMonth).toBe(20);
  });
});
