import type { AccessState, LogEntry, LogKind, Person, Zone } from "./types";

/**
 * 示例数据：区域按层级（0 最靠外）维护容量；
 * 初始在室人员已满足全部资质与访客陪同规则，容量不超限。
 */
export const SEED_ZONES: Zone[] = [
  { id: "z-locker", name: "更衣缓冲区", level: 0, capacity: 6, note: "一更 / 二更，穿脱无尘服" },
  { id: "z-corridor", name: "洁净走廊 ISO 8", level: 1, capacity: 8, note: "一般洁净通道" },
  { id: "z-photo", name: "光刻准备间 ISO 7", level: 2, capacity: 4, note: "黄光区前室" },
  { id: "z-core", name: "核心工艺区 ISO 5", level: 3, capacity: 3, note: "最高洁净等级" },
];

export const SEED_PEOPLE: Person[] = [
  { id: "p-e1001", badge: "E1001", name: "王建国", type: "employee", trained: true, healthChecked: true, gowningQualified: true },
  { id: "p-e1002", badge: "E1002", name: "李晓敏", type: "employee", trained: true, healthChecked: true, gowningQualified: true },
  { id: "p-e1003", badge: "E1003", name: "陈昊", type: "employee", trained: true, healthChecked: true, gowningQualified: true },
  { id: "p-e1004", badge: "E1004", name: "赵敏", type: "employee", trained: true, healthChecked: true, gowningQualified: false },
  { id: "p-e1005", badge: "E1005", name: "孙伟", type: "employee", trained: false, healthChecked: true, gowningQualified: true },
  { id: "p-e1006", badge: "E1006", name: "周婷", type: "employee", trained: true, healthChecked: false, gowningQualified: true },
  { id: "p-e1007", badge: "E1007", name: "吴磊", type: "employee", trained: true, healthChecked: true, gowningQualified: true },
  { id: "p-e1008", badge: "E1008", name: "郑凯", type: "employee", trained: true, healthChecked: true, gowningQualified: true },
  { id: "p-v2001", badge: "V2001", name: "佐藤·供应商", type: "visitor", company: "山田株式会社", escortBadge: "E1001", trained: true, healthChecked: true, gowningQualified: true },
  { id: "p-v2002", badge: "V2002", name: "林安康·审核员", type: "visitor", company: "第三方认证", escortBadge: "E1007", trained: true, healthChecked: true, gowningQualified: true },
];

function minutesAgo(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString();
}

export function seedState(): AccessState {
  // badge -> zoneId
  const location: Record<string, string> = {
    E1008: "z-locker",
    E1003: "z-corridor",
    E1001: "z-photo",
    V2001: "z-photo", // 访客与其陪同人 E1001 同区
    E1002: "z-core",
  };
  const enteredAt: Record<string, string> = {
    E1008: minutesAgo(6),
    E1003: minutesAgo(24),
    E1001: minutesAgo(40),
    V2001: minutesAgo(38),
    E1002: minutesAgo(33),
  };
  const lastSeenZone = { ...location };
  const inside = ["E1008", "E1003", "E1001", "V2001", "E1002"];

  const logs: LogEntry[] = [];
  let seq = 0;
  const push = (
    minAgo: number,
    kind: LogKind,
    ok: boolean,
    detail: string,
    extra?: Partial<LogEntry>,
  ) => {
    logs.push({ seq: ++seq, time: minutesAgo(minAgo), kind, ok, detail, ...extra });
  };

  push(45, "system", true, "值班台上线，区域容量与人员花名载入完成");
  push(42, "entry", true, "刷卡进入更衣缓冲区（培训/健康/更衣核查通过）", { personName: "王建国", badge: "E1001", zoneName: "更衣缓冲区" });
  push(40, "move", true, "由更衣缓冲区进入光刻准备间 ISO 7", { personName: "王建国", badge: "E1001", zoneName: "光刻准备间 ISO 7" });
  push(39, "entry", true, "访客由陪同人 E1001 陪同进入更衣缓冲区", { personName: "佐藤·供应商", badge: "V2001", zoneName: "更衣缓冲区" });
  push(38, "move", true, "访客随陪同人进入光刻准备间 ISO 7", { personName: "佐藤·供应商", badge: "V2001", zoneName: "光刻准备间 ISO 7" });
  push(35, "entry", true, "刷卡进入更衣缓冲区", { personName: "李晓敏", badge: "E1002", zoneName: "更衣缓冲区" });
  push(33, "move", true, "逐级进入核心工艺区 ISO 5", { personName: "李晓敏", badge: "E1002", zoneName: "核心工艺区 ISO 5" });
  push(25, "entry", true, "刷卡进入更衣缓冲区", { personName: "陈昊", badge: "E1003", zoneName: "更衣缓冲区" });
  push(24, "move", true, "进入洁净走廊 ISO 8 巡检", { personName: "陈昊", badge: "E1003", zoneName: "洁净走廊 ISO 8" });
  push(12, "deny", false, "更衣资格未认证，禁止进入更衣缓冲区", { personName: "赵敏", badge: "E1004", zoneName: "更衣缓冲区" });
  push(8, "entry", true, "刷卡进入更衣缓冲区", { personName: "郑凯", badge: "E1008", zoneName: "更衣缓冲区" });
  push(3, "deny", false, "重复刷卡，已在本区域，不重复计数", { personName: "陈昊", badge: "E1003", zoneName: "洁净走廊 ISO 8" });

  return {
    version: 1,
    zones: SEED_ZONES.map((z) => ({ ...z })),
    people: SEED_PEOPLE.map((p) => ({ ...p })),
    presence: { location, enteredAt, lastSeenZone, inside },
    logs,
    seq,
    locked: false,
  };
}
