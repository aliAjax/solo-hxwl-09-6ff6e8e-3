import { useMemo, useState } from "react";
import {
  addPerson,
  attemptMove,
  currentZoneId,
  enterFacility,
  escortPerson,
  exitFacility,
  handoverEscort,
  musterRows,
  occupancyMap,
  personByBadge,
  qualBlockers,
  setCapacity,
  setLockdown,
  setQualification,
  zoneById,
  type ActionResult,
} from "./engine";
import { durationLabel, formatClock, formatTime } from "./format";
import { useAccessState } from "./storage";
import type { AccessState, LogKind, Person, Qualification, Zone } from "./types";

type RunFn = <Args extends unknown[]>(
  fn: (prev: AccessState, ...args: Args) => ActionResult,
  ...args: Args
) => ActionResult;

const LOG_KIND_LABEL: Record<LogKind, string> = {
  entry: "进入",
  exit: "离场",
  move: "移动",
  deny: "拒绝",
  escort: "陪同",
  lockdown: "封锁",
  admin: "管理",
  system: "系统",
};

const QUAL_LABEL: { key: keyof Qualification; label: string }[] = [
  { key: "trained", label: "培训" },
  { key: "healthChecked", label: "健康核查" },
  { key: "gowningQualified", label: "更衣资格" },
];

interface Flash {
  ok: boolean;
  text: string;
}

function zonesByLevel(state: AccessState): Zone[] {
  return [...state.zones].sort((a, b) => a.level - b.level);
}

function capText(zone: Zone): string {
  return zone.capacity === 0 ? "不限" : `${zone.capacity} 人`;
}

/* ================================================================== */
/* 顶部状态条                                                          */
/* ================================================================== */

function StatStrip({ state }: { state: AccessState }) {
  const inside = state.presence.inside.length;
  const occ = occupancyMap(state);
  const fullZones = state.zones.filter((z) => z.capacity > 0 && occ[z.id] >= z.capacity);
  const visitorInside = state.people.filter(
    (p) => p.type === "visitor" && state.presence.inside.includes(p.badge),
  ).length;

  const stats = [
    { label: "当前在室", value: String(inside), tone: state.locked ? "danger" : "ok" },
    { label: "在室访客", value: String(visitorInside), tone: "ok" },
    { label: "受控区域", value: String(state.zones.length), tone: "neutral" },
    { label: "容量已满区域", value: String(fullZones.length), tone: fullZones.length ? "warn" : "neutral" },
    { label: "封锁状态", value: state.locked ? "封锁中" : "正常", tone: state.locked ? "danger" : "ok" },
  ];

  return (
    <div className="stat-strip">
      {stats.map((s) => (
        <div key={s.label} className={`stat-cell stat-${s.tone}`}>
          <span>{s.label}</span>
          <strong>{s.value}</strong>
        </div>
      ))}
    </div>
  );
}

/* ================================================================== */
/* 刷卡通行台                                                          */
/* ================================================================== */

function SwipeDeck({ state, run, flash }: { state: AccessState; run: RunFn; flash: (f: Flash) => void }) {
  const [badgeInput, setBadgeInput] = useState("E1004");
  const key = badgeInput.trim().toUpperCase();
  const person = key ? personByBadge(state, key) : undefined;
  const hereId = person ? currentZoneId(state, key) : undefined;
  const here = hereId ? zoneById(state, hereId) : undefined;
  const occ = occupancyMap(state);

  const doRun = <Args extends unknown[]>(fn: (prev: AccessState, ...args: Args) => ActionResult, label: string, ...args: Args) => {
    const r = run(fn, ...args);
    flash({ ok: r.verdict.ok, text: `${label}：${r.verdict.reason}` });
  };

  // 相邻（逐级）目标区域
  const adjacent = person && here
    ? zonesByLevel(state).filter((z) => Math.abs(z.level - here.level) === 1)
    : [];

  const isVisitor = person?.type === "visitor";
  const escort = person ? escortPerson(state, person) : undefined;
  const escortHere = escort ? currentZoneId(state, escort.badge) === hereId : false;
  const blockers = person ? qualBlockers(person) : [];

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>门禁值班台</p>
          <h2>刷卡通行 / 逐级移动</h2>
        </div>
        <span className={`rule-tag ${state.locked ? "tag-danger" : "tag-ok"}`}>
          {state.locked ? "封锁中 · 只出不进" : "通行正常"}
        </span>
      </div>

      <div className="swipe-input-row">
        <input
          value={badgeInput}
          onChange={(e) => setBadgeInput(e.target.value)}
          placeholder="扫描 / 输入工号（如 E1001、V2001）"
          onKeyDown={(e) => {
            if (e.key === "Enter" && person) {
              if (hereId && here?.level === 0) doRun(exitFacility, "离场", key);
              else if (!hereId) doRun(enterFacility, "进入", key);
            }
          }}
        />
        {!hereId || !here ? (
          <button
            className="primary-action"
            disabled={!person || state.locked}
            onClick={() => doRun(enterFacility, "进入设施", key)}
          >
            刷卡进入更衣缓冲区
          </button>
        ) : (
          <button
            className="exit-action"
            disabled={here.level !== 0}
            title={here.level !== 0 ? "请先用下方「退至」逐级退到更衣缓冲区" : "刷卡离场"}
            onClick={() => doRun(exitFacility, "离场", key)}
          >
            {here.level === 0 ? "刷卡离场" : `在 L${here.level}，请先逐级退出`}
          </button>
        )}
      </div>

      {key && !person && <p className="hint hint-danger">未登记工号 {key}：请先在「人员花名」中登记。</p>}

      {person && (
        <div className={`person-card ${isVisitor ? "is-visitor" : ""}`}>
          <div className="person-head">
            <div>
              <strong>
                {person.name} <span className="badge-code">{person.badge}</span>
              </strong>
              <span className="person-meta">
                {isVisitor ? `访客 · ${person.company ?? "外部单位"}` : "员工"}
                {isVisitor && escort ? ` · 陪同人 ${escort.name}（${escort.badge}）` : ""}
              </span>
            </div>
            <div className="person-where">
              {here ? (
                <>
                  <span className="where-zone">当前：{here.name}</span>
                  <span className="where-dur">{durationLabel(state.presence.enteredAt[key])}</span>
                </>
              ) : (
                <span className="where-zone out">当前在设施外</span>
              )}
            </div>
          </div>

          <div className="qual-row">
            {QUAL_LABEL.map((q) => {
              const ok = person[q.key];
              return (
                <span key={q.key} className={`qual-pill ${ok ? "qual-ok" : "qual-no"}`}>
                  {ok ? "✓" : "✕"} {q.label}
                </span>
              );
            })}
          </div>
          {blockers.length > 0 && <p className="hint hint-danger">准入拦截：{blockers.join("、")}</p>}

          {isVisitor && here && !escortHere && (
            <p className="hint hint-warn">
              陪同人 {escort ? `${escort.name} 不在同一区域` : "缺失"}：访客无法独自移动，需当面「陪同交接」。
            </p>
          )}

          {here && adjacent.length > 0 && (
            <div className="move-row">
              <span className="move-label">逐级移动（刷卡进入相邻区域）：</span>
              <div className="move-btns">
                {adjacent.map((z) => {
                  const inward = z.level > here.level;
                  const disabled = state.locked && inward;
                  const full = z.capacity > 0 && occ[z.id] + (isVisitor && escortHere ? 2 : 1) > z.capacity;
                  return (
                    <button
                      key={z.id}
                      className={inward ? "move-in" : "move-out"}
                      disabled={disabled}
                      title={
                        disabled
                          ? "封锁中禁止进入"
                          : full
                            ? "容量不足（访客与陪同人按 2 人计）"
                            : `${inward ? "进入" : "退至"} ${z.name}`
                      }
                      onClick={() => doRun(attemptMove, inward ? "进入区域" : "退出区域", key, z.id)}
                    >
                      {inward ? "进入" : "退至"} {z.name}
                      <small>
                        {" "}
                        · {occ[z.id]}/{z.capacity === 0 ? "∞" : z.capacity}
                      </small>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="hint">
        规则提示：重复刷卡不重复计数；同一人同时只在一个区域；跨区移动时来源区退出与目标区进入原子提交，任一条件不满足则整组取消、原位不变。
      </p>
    </section>
  );
}

/* ================================================================== */
/* 陪同交接                                                            */
/* ================================================================== */

function HandoverPanel({ state, run, flash }: { state: AccessState; run: RunFn; flash: (f: Flash) => void }) {
  const visitorsInside = state.people.filter(
    (p) => p.type === "visitor" && state.presence.inside.includes(p.badge),
  );
  const [visitorBadge, setVisitorBadge] = useState("");
  const [nextBadge, setNextBadge] = useState("");

  const visitor = visitorBadge ? personByBadge(state, visitorBadge) : undefined;
  const zoneId = visitor ? currentZoneId(state, visitorBadge) : undefined;
  const candidates = state.people.filter(
    (p) => p.type === "employee" && zoneId && currentZoneId(state, p.badge) === zoneId && p.badge !== visitor?.escortBadge,
  );

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>访客陪同</p>
          <h2>陪同交接 / 离场前确认</h2>
        </div>
      </div>
      {visitorsInside.length === 0 ? (
        <p className="hint">当前没有在室访客。</p>
      ) : (
        <div className="handover-grid">
          <label>
            <span>选择在室访客</span>
            <select value={visitorBadge} onChange={(e) => setVisitorBadge(e.target.value)}>
              <option value="">— 请选择 —</option>
              {visitorsInside.map((v) => {
                const z = currentZoneId(state, v.badge);
                return (
                  <option key={v.badge} value={v.badge}>
                    {v.name}（{v.badge}）· 现陪同 {v.escortBadge} · {z ? zoneById(state, z)?.name : ""}
                  </option>
                );
              })}
            </select>
          </label>
          <label>
            <span>新陪同人（须同区在岗员工）</span>
            <select
              value={nextBadge}
              onChange={(e) => setNextBadge(e.target.value)}
              disabled={!visitor}
            >
              <option value="">— 请选择 —</option>
              {candidates.map((e) => (
                <option key={e.badge} value={e.badge}>
                  {e.name}（{e.badge}）
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-action"
            disabled={!visitor || !nextBadge}
            onClick={() => {
              const r = run(handoverEscort, visitorBadge, nextBadge);
              flash({ ok: r.verdict.ok, text: `陪同交接：${r.verdict.reason}` });
              setVisitorBadge("");
              setNextBadge("");
            }}
          >
            办理交接
          </button>
        </div>
      )}
      <p className="hint">访客仅在陪同人在场时可进入；陪同人离开前，必须「一起移动 / 先送访客离场 / 办理交接」三者之一。</p>
    </section>
  );
}

/* ================================================================== */
/* 区域层级与容量                                                      */
/* ================================================================== */

function ZoneBoard({ state, run, flash }: { state: AccessState; run: RunFn; flash: (f: Flash) => void }) {
  const ordered = zonesByLevel(state);
  const occ = occupancyMap(state);

  const changeCap = (zone: Zone, delta: number) => {
    const next = zone.capacity + delta;
    if (next < 0) return;
    const r = run(setCapacity, zone.id, next);
    if (!r.verdict.ok) flash({ ok: false, text: `容量调整：${r.verdict.reason}` });
  };

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>区域层级</p>
          <h2>容量与在区人员</h2>
        </div>
        <span className="rule-tag tag-neutral">由外到内逐级进入</span>
      </div>

      <ol className="zone-list">
        {ordered.map((zone, idx) => {
          const here = state.people.filter((p) => state.presence.location[p.badge] === zone.id);
          const ratio = zone.capacity === 0 ? 0 : occ[zone.id] / zone.capacity;
          const tone = zone.capacity === 0 ? "free" : ratio >= 1 ? "full" : ratio >= 0.75 ? "near" : "ok";
          return (
            <li key={zone.id} className={`zone-row zone-${tone}`}>
              <div className="zone-level">
                <span className="level-badge">L{zone.level}</span>
                {idx < ordered.length - 1 && <span className="level-arrow">▼</span>}
              </div>
              <div className="zone-main">
                <div className="zone-title">
                  <strong>{zone.name}</strong>
                  {zone.note && <span className="zone-note">{zone.note}</span>}
                </div>
                <div className="zone-people">
                  {here.length === 0 ? (
                    <span className="zone-empty">空</span>
                  ) : (
                    here.map((p) => (
                      <span key={p.badge} className={`chip-person ${p.type === "visitor" ? "visitor" : ""}`}>
                        {p.name}
                        {p.type === "visitor" ? ` · 访客` : ""}
                      </span>
                    ))
                  )}
                </div>
              </div>
              <div className="zone-cap">
                <div className="cap-num">
                  <strong>
                    {occ[zone.id]}/{zone.capacity === 0 ? "∞" : zone.capacity}
                  </strong>
                  <span>{capText(zone)}</span>
                </div>
                <div className="cap-stepper">
                  <button title="减小容量" onClick={() => changeCap(zone, -1)}>
                    −
                  </button>
                  <button
                    title={zone.capacity === 0 ? "设为 3 人" : "设为不限"}
                    onClick={() => {
                      const r = run(setCapacity, zone.id, zone.capacity === 0 ? 3 : 0);
                      if (!r.verdict.ok) flash({ ok: false, text: `容量调整：${r.verdict.reason}` });
                    }}
                  >
                    {zone.capacity === 0 ? "限" : "∞"}
                  </button>
                  <button title="增大容量" onClick={() => changeCap(zone, 1)}>
                    +
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ================================================================== */
/* 应急清点                                                            */
/* ================================================================== */

function MusterPanel({ state }: { state: AccessState }) {
  const rows = musterRows(state);
  const byZone = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byZone.get(r.zone.id) ?? [];
    arr.push(r);
    byZone.set(r.zone.id, arr);
  }

  return (
    <section className={`panel muster ${state.locked ? "muster-locked" : ""}`}>
      <div className="section-heading">
        <div>
          <p>应急清点</p>
          <h2>{state.locked ? "封锁清点 · 滞留人员" : "实时清点（最近位置）"}</h2>
        </div>
        <span className={`rule-tag ${state.locked ? "tag-danger" : "tag-ok"}`}>
          滞留 {rows.length} 人
        </span>
      </div>

      {state.locked && (
        <div className="lockdown-banner">
          <strong>⛔ 紧急封锁已启动</strong>
          <span>
            {state.lockedReason} · {state.lockedAt ? formatClock(state.lockedAt) : ""} 起 · 禁止进入，仅允许向外侧离场
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="hint">洁净室内已无滞留人员，清点为零。</p>
      ) : (
        <div className="muster-zones">
          {zonesByLevel(state)
            .filter((z) => byZone.has(z.id))
            .map((z) => (
              <div key={z.id} className="muster-zone">
                <header>
                  <strong>{z.name}</strong>
                  <span>{byZone.get(z.id)!.length} 人</span>
                </header>
                <ul>
                  {byZone.get(z.id)!.map((r) => (
                    <li key={r.person.badge}>
                      <span className="m-name">
                        {r.person.name}
                        {r.person.type === "visitor" && <em className="tag-visitor">访客</em>}
                      </span>
                      <span className="m-sub">
                        {r.person.badge}
                        {r.person.type === "visitor" && r.escort ? ` · 陪同 ${r.escort.name}` : ""} ·{" "}
                        {durationLabel(r.enteredAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

/* ================================================================== */
/* 人员花名 + 登记 + 资质维护                                          */
/* ================================================================== */

function RosterPanel({ state, run, flash }: { state: AccessState; run: RunFn; flash: (f: Flash) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    badge: "",
    type: "employee" as Person["type"],
    company: "",
    escortBadge: "E1001",
    trained: true,
    healthChecked: true,
    gowningQualified: true,
  });

  const employees = state.people.filter((p) => p.type === "employee");

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>人员花名</p>
          <h2>资质 / 健康 / 更衣资格维护</h2>
        </div>
        <button className="primary-action" onClick={() => setOpen((v) => !v)}>
          {open ? "收起登记" : "登记新人员"}
        </button>
      </div>

      {open && (
        <div className="new-person">
          <div className="field-grid">
            <label>
              <span>姓名</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 王建国" />
            </label>
            <label>
              <span>工号 / 卡号</span>
              <input value={form.badge} onChange={(e) => setForm({ ...form, badge: e.target.value })} placeholder="如 E1009 / V2003" />
            </label>
            <label>
              <span>类型</span>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as Person["type"] })}
              >
                <option value="employee">员工</option>
                <option value="visitor">访客</option>
              </select>
            </label>
            {form.type === "visitor" ? (
              <>
                <label>
                  <span>单位</span>
                  <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="来访单位" />
                </label>
                <label>
                  <span>陪同人（员工工号）</span>
                  <select
                    value={form.escortBadge}
                    onChange={(e) => setForm({ ...form, escortBadge: e.target.value })}
                  >
                    {employees.map((e) => (
                      <option key={e.badge} value={e.badge}>
                        {e.name}（{e.badge}）
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
          </div>
          <div className="qual-row new-qual">
            {QUAL_LABEL.map((q) => (
              <label key={q.key} className="qual-check">
                <input
                  type="checkbox"
                  checked={form[q.key]}
                  onChange={(e) => setForm({ ...form, [q.key]: e.target.checked })}
                />
                {q.label}
              </label>
            ))}
          </div>
          <button
            className="primary-action"
            onClick={() => {
              const r = run(addPerson, form);
              flash({ ok: r.verdict.ok, text: `人员登记：${r.verdict.reason}` });
              if (r.verdict.ok)
                setForm({ name: "", badge: "", type: "employee", company: "", escortBadge: "E1001", trained: true, healthChecked: true, gowningQualified: true });
            }}
          >
            保存到花名
          </button>
        </div>
      )}

      <div className="roster-table-wrap">
        <table className="roster-table">
          <thead>
            <tr>
              <th>工号</th>
              <th>姓名 / 类型</th>
              <th>当前位置</th>
              <th>培训</th>
              <th>健康核查</th>
              <th>更衣资格</th>
            </tr>
          </thead>
          <tbody>
            {state.people.map((p) => {
              const zid = currentZoneId(state, p.badge);
              const zone = zid ? zoneById(state, zid) : undefined;
              return (
                <tr key={p.badge} className={p.type === "visitor" ? "row-visitor" : ""}>
                  <td className="badge-code">{p.badge}</td>
                  <td>
                    {p.name}
                    {p.type === "visitor" ? <em className="tag-visitor">访客</em> : <em className="tag-emp">员工</em>}
                    {p.type === "visitor" && <span className="escort-of">陪同 {p.escortBadge}</span>}
                  </td>
                  <td>{zone ? zone.name : <span className="muted">设施外</span>}</td>
                  {QUAL_LABEL.map((q) => (
                    <td key={q.key}>
                      <button
                        className={`toggle-qual ${p[q.key] ? "on" : "off"}`}
                        onClick={() => {
                          const r = run(setQualification, p.badge, q.key, !p[q.key]);
                          flash({ ok: true, text: r.verdict.reason });
                        }}
                      >
                        {p[q.key] ? "通过" : "未过"}
                      </button>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ================================================================== */
/* 完整操作流水                                                        */
/* ================================================================== */

const LOG_FILTERS: { key: LogKind | "all" | "fail"; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "fail", label: "仅被拒/失败" },
  { key: "entry", label: "进入" },
  { key: "move", label: "移动" },
  { key: "exit", label: "离场" },
  { key: "deny", label: "拦截" },
  { key: "escort", label: "陪同" },
  { key: "lockdown", label: "封锁" },
  { key: "admin", label: "管理" },
  { key: "system", label: "系统" },
];

function LogPanel({ state }: { state: AccessState }) {
  const [filter, setFilter] = useState<LogKind | "all" | "fail">("all");
  const [query, setQuery] = useState("");

  const logs = useMemo(() => {
    const q = query.trim().toUpperCase();
    return state.logs.filter((l) => {
      if (filter === "fail" && l.ok) return false;
      if (filter !== "all" && filter !== "fail" && l.kind !== filter) return false;
      if (q) {
        const hay = `${l.badge ?? ""} ${l.personName ?? ""} ${l.zoneName ?? ""} ${l.detail}`.toUpperCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [state.logs, filter, query]);

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>操作流水（完整保留，刷新不丢）</p>
          <h2>通行审计日志 · 共 {state.logs.length} 条</h2>
        </div>
        <input
          className="log-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索工号 / 姓名 / 区域"
        />
      </div>
      <div className="log-filters">
        {LOG_FILTERS.map((f) => (
          <button key={f.key} className={filter === f.key ? "lf-active" : ""} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="log-list">
        {logs.length === 0 && <p className="hint">没有符合条件的记录。</p>}
        {logs.map((l) => (
          <article key={l.seq} className={`log-row ${l.ok ? "log-ok" : "log-fail"}`}>
            <span className="log-seq">#{l.seq}</span>
            <span className="log-time">{formatTime(l.time)}</span>
            <span className={`log-kind kind-${l.kind} ${l.ok ? "" : "kind-fail"}`}>
              {LOG_KIND_LABEL[l.kind]}
            </span>
            <div className="log-body">
              <p>{l.detail}</p>
              <span className="log-meta">
                {[l.personName ? `${l.personName}（${l.badge}）` : "", l.zoneName ?? ""].filter(Boolean).join(" · ")}
              </span>
            </div>
            <span className={`log-state ${l.ok ? "is-ok" : "is-fail"}`}>{l.ok ? "成功" : "拒绝"}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ================================================================== */
/* 控制台外壳                                                          */
/* ================================================================== */

export default function AccessConsole() {
  const { state, apply, reset } = useAccessState();
  const [flash, setFlash] = useState<Flash | null>(null);
  const [lockReason, setLockReason] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  const run: RunFn = (fn, ...args) => {
    const r = apply(fn, ...args);
    return r;
  };

  const showFlash = (f: Flash) => {
    setFlash(f);
    window.setTimeout(() => setFlash(null), 4200);
  };

  const toggleLock = () => {
    if (!state.locked) {
      const r = run(setLockdown, true, lockReason.trim() || "现场紧急情况");
      showFlash({ ok: r.verdict.ok, text: r.verdict.reason });
      setLockReason("");
    } else {
      const r = run(setLockdown, false, "");
      showFlash({ ok: r.verdict.ok, text: r.verdict.reason });
    }
  };

  return (
    <div className="access-console">
      <section className="console-hero panel">
        <div>
          <p className="eyebrow">门禁值班员 · 人员通行与应急清点台</p>
          <h2>人员通行 · 层级容量 · 访客陪同 · 应急封锁清点</h2>
          <p className="subtitle">
            进入须同时满足培训、健康核查、更衣资格与区域容量；逐级进出、刷卡去重、单人单区、跨区原子移动。
          </p>
        </div>
        <div className="lockdown-ctl">
          {!state.locked ? (
            <>
              <input
                value={lockReason}
                onChange={(e) => setLockReason(e.target.value)}
                placeholder="封锁事由（可选），如：气体报警"
              />
              <button className="lock-btn" onClick={toggleLock}>
                启动紧急封锁
              </button>
            </>
          ) : (
            <button className="unlock-btn" onClick={toggleLock}>
              解除封锁 · 恢复通行
            </button>
          )}
          <button
            className="reset-btn"
            onClick={() => {
              if (confirmReset) {
                reset();
                setConfirmReset(false);
                showFlash({ ok: true, text: "已恢复示例数据" });
              } else {
                setConfirmReset(true);
                window.setTimeout(() => setConfirmReset(false), 3000);
              }
            }}
          >
            {confirmReset ? "再次点击确认重置" : "重置为示例数据"}
          </button>
        </div>
      </section>

      <StatStrip state={state} />

      {flash && (
        <div className={`action-flash ${flash.ok ? "flash-ok" : "flash-fail"}`}>
          <span>{flash.ok ? "✓ " : "⛔ "}</span>
          {flash.text}
        </div>
      )}

      <div className="console-grid">
        <div className="col-main">
          <SwipeDeck state={state} run={run} flash={showFlash} />
          <MusterPanel state={state} />
          <LogPanel state={state} />
        </div>
        <div className="col-side">
          <ZoneBoard state={state} run={run} flash={showFlash} />
          <HandoverPanel state={state} run={run} flash={showFlash} />
          <RosterPanel state={state} run={run} flash={showFlash} />
        </div>
      </div>
    </div>
  );
}
