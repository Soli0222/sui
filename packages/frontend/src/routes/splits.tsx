import { useState } from "react";
import { SegmentedControl } from "../components/ui/segmented-control";
import { MembersTab } from "../components/splits/members-tab";
import { SplitsTab } from "../components/splits/splits-tab";
import { SettlementsTab } from "../components/splits/settlements-tab";
type Tab = "members" | "splits" | "settlements";
export function SplitsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("members");

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">割り勘</h2>
          <p className="mt-2 text-sm text-ink-2">立替・回収の管理を行います。</p>
        </div>
      </div>

      <SegmentedControl<Tab>
        aria-label="割り勘タブ"
        options={[
          { value: "members", label: "メンバー" },
          { value: "splits", label: "割り勘一覧" },
          { value: "settlements", label: "精算" },
        ]}
        value={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "members" && <MembersTab />}
      {activeTab === "splits" && <SplitsTab />}
      {activeTab === "settlements" && <SettlementsTab />}
    </div>
  );
}
