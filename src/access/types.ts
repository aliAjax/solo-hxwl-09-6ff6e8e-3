// 人员通行与应急清点台 —— 领域类型

export type PersonType = "employee" | "visitor";

/** 人员资质：培训 / 健康核查 / 更衣资格 */
export interface Qualification {
  trained: boolean;
  healthChecked: boolean;
  gowningQualified: boolean;
}

export interface Person extends Qualification {
  id: string;
  name: string;
  badge: string;
  type: PersonType;
  company?: string;
  /** 访客当前陪同人工号；员工为空 */
  escortBadge?: string;
}

export interface Zone {
  id: string;
  name: string;
  /** 层级 0 最靠外，数字越大越深入洁净室 */
  level: number;
  /** 0 = 不限容量 */
  capacity: number;
  note?: string;
}

export type LogKind =
  | "entry"
  | "exit"
  | "move"
  | "deny"
  | "escort"
  | "lockdown"
  | "admin"
  | "system";

export interface LogEntry {
  seq: number;
  time: string; // ISO
  kind: LogKind;
  ok: boolean;
  personName?: string;
  badge?: string;
  zoneName?: string;
  detail: string;
}

export interface Presence {
  /** badge -> zoneId（全室最多一条，保证同一人不能同时在两个区域） */
  location: Record<string, string>;
  /** badge -> 进入当前区域的时间 ISO */
  enteredAt: Record<string, string>;
  /** 每个区域内停留过/在区内的工号，用于“最近位置”与滞留判断 */
  lastSeenZone: Record<string, string>;
  /** 仍在洁净室内的工号集合（可能因封锁滞留） */
  inside: string[];
}

export interface AccessState {
  version: number;
  zones: Zone[];
  people: Person[];
  presence: Presence;
  logs: LogEntry[];
  seq: number;
  locked: boolean;
  lockedAt?: string;
  lockedReason?: string;
}

/** 一次规则判定结果 */
export interface Verdict {
  ok: boolean;
  reason: string;
}
