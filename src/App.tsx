import { useState } from "react";
import "./styles.css";
import InspectionDashboard from "./InspectionDashboard";
import AccessConsole from "./access/AccessConsole";

type Tab = "board" | "access";

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: "board", label: "巡检看板", hint: "洁净等级阈值 · 粒子计数 · 异常处理" },
  { key: "access", label: "通行与应急清点台", hint: "门禁值班员 · 人员通行 · 应急封锁" },
];

function App() {
  const [tab, setTab] = useState<Tab>("access");

  return (
    <main className="app-shell">
      <nav className="top-tabs" aria-label="功能切换">
        <div className="brand">
          <strong>hxwl-09</strong>
          <span>半导体洁净室</span>
        </div>
        <div className="tab-btns">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? "tab-btn active" : "tab-btn"}
              onClick={() => setTab(t.key)}
              title={t.hint}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {tab === "board" ? <InspectionDashboard /> : <AccessConsole />}
    </main>
  );
}

export default App;
