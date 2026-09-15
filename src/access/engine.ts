import type { AccessState, LogKind, Person, Presence, Qualification, Verdict, Zone } from "./types";

export interface ActionResult {
  state: AccessState;
  verdict: Verdict;
}

export const OUTSIDE = "outside";

/* ------------------------------------------------------------------ */
/* 选择器                                                              */
/* ------------------------------------------------------------------ */

export function zoneById(state: AccessState, zoneId: string): Zone | undefined {
  return state.zones.find((z) => z.id === zoneId);
}

export function personByBadge(state: AccessState, badge: string): Person | undefined {
  const key = badge.trim().toUpperCase();
  return state.people.find((p) => p.badge.toUpperCase() === key);
}

/** 人员当前所在区域；不在洁净室返回 undefined（同一人至多一个区域） */
export function currentZoneId(state: AccessState, badge: string): string | undefined {
  return state.presence.location[badge];
}

export function occupancy(state: AccessState, zoneId: string): number {
  return Object.values(state.presence.location).filter((id) => id === zoneId).length;
}

export function occupancyMap(state: AccessState): Record<string, number> {
  const map: Record<string, number> = {};
  for (const z of state.zones) map[z.id] = 0;
  for (const id of Object.values(state.presence.location)) map[id] = (map[id] ?? 0) + 1;
  return map;
}

export function escortPerson(state: AccessState, visitor: Person): Person | undefined {
  if (visitor.type !== "visitor" || !visitor.escortBadge) return undefined;
  return state.people.find((p) => p.badge === visitor.escortBadge && p.type === "employee");
}

/** 该员工作为陪同人，仍在洁净室内的访客 */
export function escortedVisitorsInside(state: AccessState, employeeBadge: string): Person[] {
  return state.people.filter(
    (p) => p.type === "visitor" && p.escortBadge === employeeBadge && state.presence.inside.includes(p.badge),
  );
}

export function qualBlockers(person: Person): string[] {
  const miss: string[] = [];
  if (!person.trained) miss.push("培训未通过");
  if (!person.healthChecked) miss.push("健康核查未通过");
  if (!person.gowningQualified) miss.push("更衣资格未认证");
  return miss;
}

export interface MusterRow {
  person: Person;
  zone: Zone;
  enteredAt?: string;
  escort?: Person;
}

/** 应急清点：当前滞留人员与最近位置（封锁/平时均可查看） */
export function musterRows(state: AccessState): MusterRow[] {
  return state.presence.inside
    .map((badge) => {
      const person = state.people.find((p) => p.badge === badge);
      const zoneId = state.presence.location[badge] ?? state.presence.lastSeenZone[badge];
      const zone = zoneId ? zoneById(state, zoneId) : undefined;
      if (!person || !zone) return null;
      return {
        person,
        zone,
        enteredAt: state.presence.enteredAt[badge],
        escort: escortPerson(state, person),
      } as MusterRow;
    })
    .filter((r): r is MusterRow => r !== null)
    .sort((a, b) => a.zone.level - b.zone.level || a.person.badge.localeCompare(b.person.badge));
}

/* ------------------------------------------------------------------ */
/* 内部工具                                                            */
/* ------------------------------------------------------------------ */

function nowIso(): string {
  return new Date().toISOString();
}

function log(
  prev: AccessState,
  kind: LogKind,
  ok: boolean,
  detail: string,
  extra?: { person?: Person; zone?: Zone },
): AccessState {
  const state = structuredClone(prev);
  const entry = {
    seq: state.seq + 1,
    time: nowIso(),
    kind,
    ok,
    detail,
    personName: extra?.person?.name,
    badge: extra?.person?.badge,
    zoneName: extra?.zone?.name,
  };
  state.seq += 1;
  state.logs.unshift(entry); // 最新在前；完整流水保留，不截断
  return state;
}

function deny(prev: AccessState, reason: string, extra?: { person?: Person; zone?: Zone }): ActionResult {
  return { state: log(prev, "deny", false, reason, extra), verdict: { ok: false, reason } };
}

function approve(prev: AccessState, kind: LogKind, detail: string, extra?: { person?: Person; zone?: Zone }): ActionResult {
  const state = log(prev, kind, true, detail, extra);
  return { state, verdict: { ok: true, reason: detail } };
}

/** 原子地把工号集合从来源区迁到目标区（先校验后提交） */
function relocate(prev: AccessState, badges: string[], targetId: string, time: string): Presence {
  const presence = structuredClone(prev.presence);
  for (const badge of badges) {
    delete presence.location[badge];
    presence.location[badge] = targetId;
    presence.enteredAt[badge] = time;
    presence.lastSeenZone[badge] = targetId;
  }
  return presence;
}

/* ------------------------------------------------------------------ */
/* 动作                                                                */
/* ------------------------------------------------------------------ */

/** 刷卡进入设施（进入最外层 更衣缓冲区） */
export function enterFacility(prev: AccessState, rawBadge: string): ActionResult {
  const badge = rawBadge.trim().toUpperCase();
  const person = personByBadge(prev, badge);
  if (!person) return deny(prev, `未找到工号 ${badge}，请先登记人员花名`);

  const locker = prev.zones.find((z) => z.level === 0);
  if (!locker) return deny(prev, "未配置最外层更衣区");

  if (prev.locked)
    return deny(prev, "紧急封锁中：禁止进入，仅允许离场", { person, zone: locker });

  // 重复刷卡不能重复计数
  if (currentZoneId(prev, badge))
    return deny(prev, `重复刷卡：${person.name} 已在洁净室内，不能重复计数`, { person });

  const missing = qualBlockers(person);
  if (missing.length)
    return deny(prev, `准入核查未通过（${missing.join("、")}），禁止进入`, { person, zone: locker });

  if (locker.capacity > 0 && occupancy(prev, locker.id) >= locker.capacity)
    return deny(prev, `${locker.name} 容量已满（${locker.capacity} 人），禁止进入`, { person, zone: locker });

  // 访客：陪同人必须在场（同在更衣缓冲区）
  if (person.type === "visitor") {
    const escort = escortPerson(prev, person);
    if (!escort)
      return deny(prev, "访客无陪同人登记，禁止进入", { person, zone: locker });
    if (currentZoneId(prev, escort.badge) !== locker.id)
      return deny(prev, `陪同人 ${escort.name}（${escort.badge}）不在 ${locker.name}，访客须在陪同人在场时进入`, {
        person,
        zone: locker,
      });
  }

  let state = structuredClone(prev);
  const t = nowIso();
  state.presence.location[badge] = locker.id;
  state.presence.enteredAt[badge] = t;
  state.presence.lastSeenZone[badge] = locker.id;
  if (!state.presence.inside.includes(badge)) state.presence.inside.push(badge);

  const detail =
    person.type === "visitor"
      ? `访客由陪同人 ${person.escortBadge} 陪同进入 ${locker.name}（培训/健康/更衣核查通过）`
      : `刷卡进入 ${locker.name}（培训/健康/更衣核查通过）`;
  return approve(state, "entry", detail, { person, zone: locker });
}

/**
 * 尝试进入/退到相邻区域（逐级）。
 * 员工：单人原子迁移；访客：与陪同人成对原子迁移（一起成功或一起失败）。
 */
export function attemptMove(prev: AccessState, rawBadge: string, targetId: string): ActionResult {
  const badge = rawBadge.trim().toUpperCase();
  const person = personByBadge(prev, badge);
  if (!person) return deny(prev, `未找到工号 ${badge}`);
  const target = zoneById(prev, targetId);
  if (!target) return deny(prev, "目标区域不存在", { person });

  const sourceId = currentZoneId(prev, badge);
  if (!sourceId)
    return deny(prev, `${person.name} 当前不在洁净室内，请先在更衣缓冲区刷卡进入`, { person, zone: target });
  if (sourceId === targetId)
    return deny(prev, `重复刷卡：${person.name} 已在 ${target.name}，不重复计数`, { person, zone: target });

  const source = zoneById(prev, sourceId)!;
  const levelDelta = target.level - source.level;
  if (Math.abs(levelDelta) !== 1)
    return deny(prev, `须按区域路径逐级移动，不能由 ${source.name} 直接前往 ${target.name}`, { person, zone: target });

  const inward = levelDelta === 1;
  if (prev.locked && inward)
    return deny(prev, "紧急封锁中：禁止进入，仅允许向外侧离场", { person, zone: target });

  const missing = qualBlockers(person);
  if (missing.length)
    return deny(prev, `准入核查未通过（${missing.join("、")}），禁止进入 ${target.name}`, { person, zone: target });

  /* ---- 访客：必须与陪同人成对移动 ---- */
  if (person.type === "visitor") {
    const escort = escortPerson(prev, person);
    if (!escort) return deny(prev, "访客无有效陪同人，请先办理陪同交接", { person, zone: target });
    if (currentZoneId(prev, escort.badge) !== sourceId)
      return deny(
        prev,
        `陪同人 ${escort.name} 不在 ${source.name}，访客须与陪同人同行；请先办理陪同交接`,
        { person, zone: target },
      );

    const incoming = 2; // 访客 + 陪同人 同时进入目标区
    if (target.capacity > 0 && occupancy(prev, target.id) + incoming > target.capacity)
      return deny(
        prev,
        `${target.name} 剩余容量不足（需 ${incoming} 个位置，含陪同人），整组移动取消，来源区状态不变`,
        { person, zone: target },
      );

    // 全部校验通过后才提交：来源区两人退出 + 目标区两人进入 同时生效
    const t = nowIso();
    let state = prev;
    state = { ...state, presence: relocate(state, [badge, escort.badge], target.id, t) };
    const dirText = inward ? "进入" : "退出至";
    return approve(
      state,
      "move",
      `访客 ${person.name} 由陪同人 ${escort.name} 陪同，${dirText} ${target.name}（两人成组，原子移动）`,
      { person, zone: target },
    );
  }

  /* ---- 员工 ---- */
  // 陪同人离开前必须交接或先送访客离场
  const wards = escortedVisitorsInside(prev, badge).filter((v) => currentZoneId(prev, v.badge) === sourceId);
  if (wards.length)
    return deny(
      prev,
      `您陪同的访客 ${wards.map((v) => v.name).join("、")} 仍在 ${source.name}：请「陪同一起移动」、先送访客离场或办理交接后再离开`,
      { person, zone: source },
    );

  if (target.capacity > 0 && occupancy(prev, target.id) + 1 > target.capacity)
    return deny(prev, `${target.name} 容量已满（${target.capacity} 人），移动取消，来源区状态不变`, {
      person,
      zone: target,
    });

  const t = nowIso();
  let state = prev;
  state = { ...state, presence: relocate(state, [badge], target.id, t) };
  const dirText = inward ? `由 ${source.name} 进入` : `由 ${source.name} 退至`;
  return approve(state, "move", `${dirText} ${target.name}`, { person, zone: target });
}

/** 离场：仅在最外层更衣缓冲区刷卡离场（逐级退出后） */
export function exitFacility(prev: AccessState, rawBadge: string): ActionResult {
  const badge = rawBadge.trim().toUpperCase();
  const person = personByBadge(prev, badge);
  if (!person) return deny(prev, `未找到工号 ${badge}`);

  const zoneId = currentZoneId(prev, badge);
  if (!zoneId) return deny(prev, `${person.name} 已不在洁净室内，重复刷卡不计数`, { person });
  const zone = zoneById(prev, zoneId)!;
  if (zone.level !== 0)
    return deny(prev, `请按路径逐级退出至更衣缓冲区后再离场（当前在 ${zone.name}）`, { person, zone });

  if (person.type === "employee") {
    const wards = escortedVisitorsInside(prev, badge);
    if (wards.length)
      return deny(
        prev,
        `访客 ${wards.map((v) => v.name).join("、")} 仍在室内由您陪同：请先送访客离场或办理陪同交接`,
        { person, zone },
      );
  }

  const state = structuredClone(prev);
  delete state.presence.location[badge];
  delete state.presence.enteredAt[badge];
  state.presence.lastSeenZone[badge] = zone.id;
  state.presence.inside = state.presence.inside.filter((b) => b !== badge);

  const lockedNote = prev.locked ? "（封锁中离场）" : "";
  return approve(state, "exit", `由 ${zone.name} 离场${lockedNote}`, { person, zone });
}

/** 陪同交接：新陪同人必须是同区在场员工 */
export function handoverEscort(prev: AccessState, visitorBadge: string, newEscortBadge: string): ActionResult {
  const visitor = personByBadge(prev, visitorBadge);
  if (!visitor || visitor.type !== "visitor") return deny(prev, "请选择有效访客");
  const next = personByBadge(prev, newEscortBadge);
  if (!next || next.type !== "employee") return deny(prev, "交接对象必须是在岗员工", { person: visitor });
  if (next.badge === visitor.escortBadge) return deny(prev, "新陪同人与当前陪同人相同，无需交接", { person: visitor });

  const zoneId = currentZoneId(prev, visitor.badge);
  if (!zoneId) return deny(prev, "访客已离场，无需交接", { person: visitor });
  if (currentZoneId(prev, next.badge) !== zoneId)
    return deny(prev, `新陪同人 ${next.name} 不在现场（${zoneById(prev, zoneId)!.name}），无法当面交接`, {
      person: visitor,
    });
  const missing = qualBlockers(next);
  if (missing.length) return deny(prev, `新陪同人资质不全（${missing.join("、")}），不能担任陪同`, { person: visitor });

  const old = visitor.escortBadge;
  const state = structuredClone(prev);
  const v = state.people.find((p) => p.badge === visitor.badge)!;
  v.escortBadge = next.badge;
  const zone = zoneById(prev, zoneId)!;
  return approve(
    state,
    "escort",
    `访客 ${visitor.name} 陪同人由 ${old} 交接给 ${next.badge}（${next.name}），新陪同人已在场`,
    { person: visitor, zone },
  );
}

/* ------------------------------------------------------------------ */
/* 应急封锁 / 管理                                                      */
/* ------------------------------------------------------------------ */

export function setLockdown(prev: AccessState, on: boolean, reason: string): ActionResult {
  if (on && prev.locked) return { state: prev, verdict: { ok: false, reason: "已处于紧急封锁状态" } };
  if (!on && !prev.locked) return { state: prev, verdict: { ok: false, reason: "当前未封锁" } };

  let state = structuredClone(prev);
  if (on) {
    state.locked = true;
    state.lockedAt = nowIso();
    state.lockedReason = reason.trim() || "紧急封锁";
    state = log(state, "lockdown", true, `启动紧急封锁：${state.lockedReason}｜禁止进入，仅允许离场，请立即清点`);
    return { state, verdict: { ok: true, reason: "紧急封锁已启动" } };
  }
  state.locked = false;
  state.lockedAt = undefined;
  state.lockedReason = undefined;
  state = log(state, "lockdown", true, "解除紧急封锁，恢复正常通行（仍需满足准入与容量规则）");
  return { state, verdict: { ok: true, reason: "封锁已解除" } };
}

export function setCapacity(prev: AccessState, zoneId: string, capacity: number): ActionResult {
  const zone = zoneById(prev, zoneId);
  if (!zone) return deny(prev, "区域不存在");
  const cap = Math.floor(capacity);
  if (!Number.isFinite(cap) || cap < 0) return deny(prev, "容量须为不小于 0 的整数（0 表示不限）", { zone });
  if (cap > 0 && cap < occupancy(prev, zoneId))
    return deny(prev, `不能低于当前在区人数（${occupancy(prev, zoneId)} 人）`, { zone });
  if (cap === zone.capacity) return { state: prev, verdict: { ok: false, reason: "容量未变化" } };

  const state = structuredClone(prev);
  const z = state.zones.find((x) => x.id === zoneId)!;
  const old = z.capacity;
  z.capacity = cap;
  return approve(
    state,
    "admin",
    `容量调整：${zone.name} ${old === 0 ? "不限" : old} 人 → ${cap === 0 ? "不限" : cap + " 人"}`,
    { zone },
  );
}

export function setQualification(
  prev: AccessState,
  badge: string,
  key: keyof Qualification,
  value: boolean,
): ActionResult {
  const person = personByBadge(prev, badge);
  if (!person) return deny(prev, `未找到工号 ${badge}`);
  const state = structuredClone(prev);
  const p = state.people.find((x) => x.badge === person.badge)!;
  p[key] = value;
  const label = key === "trained" ? "培训" : key === "healthChecked" ? "健康核查" : "更衣资格";
  return approve(state, "admin", `${person.name}（${person.badge}）${label}${value ? "已通过/认证" : "被撤销"}`, { person });
}

export interface NewPersonInput {
  name: string;
  badge: string;
  type: Person["type"];
  company?: string;
  escortBadge?: string;
  trained: boolean;
  healthChecked: boolean;
  gowningQualified: boolean;
}

export function addPerson(prev: AccessState, input: NewPersonInput): ActionResult {
  const badge = input.badge.trim().toUpperCase();
  const name = input.name.trim();
  if (!name) return deny(prev, "请填写姓名");
  if (!badge) return deny(prev, "请填写工号/卡号");
  if (personByBadge(prev, badge)) return deny(prev, `工号 ${badge} 已存在`);
  if (input.type === "visitor") {
    if (!input.escortBadge) return deny(prev, "访客必须指定陪同人");
    const escort = personByBadge(prev, input.escortBadge);
    if (!escort || escort.type !== "employee") return deny(prev, "陪同人必须是在岗员工");
  }
  const person: Person = {
    id: `p-${badge.toLowerCase()}`,
    badge,
    name,
    type: input.type,
    company: input.company?.trim() || undefined,
    escortBadge: input.type === "visitor" ? input.escortBadge!.trim().toUpperCase() : undefined,
    trained: input.trained,
    healthChecked: input.healthChecked,
    gowningQualified: input.gowningQualified,
  };
  const state = structuredClone(prev);
  state.people.push(person);
  return approve(
    state,
    "system",
    `${input.type === "visitor" ? "访客" : "员工"} ${name}（${badge}）登记入库${
      input.type === "visitor" ? `，陪同人 ${person.escortBadge}` : ""
    }`,
    { person },
  );
}
