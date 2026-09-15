import { seedState } from "../src/access/seed";
import {
  addPerson,
  attemptMove,
  currentZoneId,
  enterFacility,
  exitFacility,
  handoverEscort,
  musterRows,
  occupancy,
  occupancyMap,
  personByBadge,
  setCapacity,
  setLockdown,
  setQualification,
  zoneById,
} from "../src/access/engine";
import type { AccessState } from "../src/access/types";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✕ FAIL: ${label}${extra ? " — " + extra : ""}`);
  }
}
function ok(r: { verdict: { ok: boolean } }) {
  return r.verdict.ok;
}
/** 不变量：单人单区 + inside 与 location 一致 + 容量不超限 */
function invariantsHold(s: AccessState, tag: string) {
  const locBadges = Object.keys(s.presence.location);
  const insideSet = [...s.presence.inside].sort().join(",");
  const locSet = [...locBadges].sort().join(",");
  check(`[${tag}] inside 集合 == 在区人员集合`, insideSet === locSet, `inside=${insideSet} loc=${locSet}`);
  check(`[${tag}] 同一人至多一个区域`, new Set(locBadges).size === locBadges.length);
  const occ = occupancyMap(s);
  for (const z of s.zones) {
    if (z.capacity > 0) {
      check(`[${tag}] ${z.name} 不超容量 (${occ[z.id]}/${z.capacity})`, occ[z.id] <= z.capacity);
    }
  }
  check(`[${tag}] 清点人数 == 在室人数`, musterRows(s).length === s.presence.inside.length);
}

/* 1. 种子数据自洽 */
{
  const s = seedState();
  check("种子：更衣缓冲区 1 人", occupancy(s, "z-locker") === 1);
  check("种子：走廊 1 人", occupancy(s, "z-corridor") === 1);
  check("种子：光刻准备间 2 人", occupancy(s, "z-photo") === 2);
  check("种子：核心区 1 人", occupancy(s, "z-core") === 1);
  check("种子：在室 5 人", s.presence.inside.length === 5);
  check(
    "种子：访客 V2001 与陪同人 E1001 同区",
    currentZoneId(s, "V2001") === currentZoneId(s, "E1001"),
  );
  check("种子：初始未封锁", s.locked === false);
  invariantsHold(s, "种子");
}

/* 2. 重复刷卡不计数 / 资质拦截 */
{
  let s = seedState();
  let r = attemptMove(s, "E1003", "z-corridor"); // 已在走廊
  check("重复刷卡：同区再刷被拒", !ok(r));
  s = r.state;
  check("重复刷卡：计数不变", occupancy(s, "z-corridor") === 1);
  r = enterFacility(s, "E1003"); // 已在设施内
  check("重复刷卡：已在室内再进入被拒", !ok(r));

  r = enterFacility(s, "E1004"); // 无更衣资格
  check("资质：缺更衣资格禁止进入", !ok(r));
  r = enterFacility(s, "E1005"); // 无培训
  check("资质：缺培训禁止进入", !ok(r));
  r = enterFacility(s, "E1006"); // 无健康核查
  check("资质：缺健康核查禁止进入", !ok(r));
  check("资质：三人都未被放入", occupancy(s, "z-locker") === 1);

  // 补齐资质后可进
  r = setQualification(s, "E1004", "gowningQualified", true);
  s = r.state;
  r = enterFacility(s, "E1004");
  check("资质：补齐更衣资格后可进入", ok(r) && currentZoneId(r.state, "E1004") === "z-locker");
  s = r.state;
  invariantsHold(s, "资质");
}

/* 3. 逐级移动 + 跨层直跳被拒 */
{
  let s = seedState();
  let r = attemptMove(s, "E1008", "z-core"); // locker(L0) -> core(L3)
  check("逐级：跨级直跳核心区被拒", !ok(r));
  check("逐级：被拒后仍在更衣缓冲区", currentZoneId(s, "E1008") === "z-locker");
  r = attemptMove(s, "E1008", "z-corridor");
  check("逐级：L0→L1 成功", ok(r) && currentZoneId(r.state, "E1008") === "z-corridor");
  s = r.state;
  invariantsHold(s, "逐级");
}

/* 4. 容量满 + 原子移动（含访客陪同成对） */
{
  let s = seedState(); // photo: E1001,V2001 ; core: E1002 (cap3)
  // 把核心容量压到 2（当前1人，允许）
  let r = setCapacity(s, "z-core", 2);
  check("容量：可下调到不低于在区人数", ok(r));
  s = r.state;
  // 访客刷卡深入：需带陪同人共 2 个位置，core 仅剩 1 -> 整组取消
  r = attemptMove(s, "V2001", "z-core");
  check("原子：容量不足时访客+陪同人整组被拒", !ok(r));
  check("原子：访客未移动", currentZoneId(s, "V2001") === "z-photo");
  check("原子：陪同人也未移动（来源区未退出）", currentZoneId(s, "E1001") === "z-photo");
  // 恢复容量后成对成功
  r = setCapacity(s, "z-core", 3);
  s = r.state;
  r = attemptMove(s, "V2001", "z-core");
  check("原子：容量满足时访客与陪同人一起进入", ok(r));
  s = r.state;
  check("原子：访客已在核心区", currentZoneId(s, "V2001") === "z-core");
  check("原子：陪同人已在核心区", currentZoneId(s, "E1001") === "z-core");
  check("原子：来源光刻间已空", occupancy(s, "z-photo") === 0);
  check("原子：核心区共 3 人", occupancy(s, "z-core") === 3);
  invariantsHold(s, "原子移动");
}

/* 5. 访客：陪同在场才能进入 + 陪同人离开前交接/送走 */
{
  let s = seedState();
  // V2002 的陪同人是 E1007（场外）。先刷访客 -> 拒
  let r = enterFacility(s, "V2002");
  check("访客：陪同人不在场禁止进入", !ok(r));
  // 陪同人先进
  r = enterFacility(s, "E1007");
  check("访客：陪同人进入更衣区", ok(r));
  s = r.state;
  r = enterFacility(s, "V2002");
  check("访客：陪同人在场时可进入", ok(r) && currentZoneId(r.state, "V2002") === "z-locker");
  s = r.state;
  // 访客刷卡 L0->L1，应同时带走陪同人
  r = attemptMove(s, "V2002", "z-corridor");
  check("访客：访客移动成组带走陪同人", ok(r));
  s = r.state;
  check("访客：陪同人 E1007 同到走廊", currentZoneId(s, "E1007") === "z-corridor");

  // 陪同人想独自离开（走廊->更衣）被拦
  r = attemptMove(s, "E1007", "z-locker");
  check("陪同：丢下访客独自离开被拦", !ok(r));
  // 直接离场也被拦（需先退到 L0，且还有访客）
  r = exitFacility(s, "E1007");
  check("陪同：在深层离场被拦", !ok(r));

  // 路径 A：先送访客离场
  r = attemptMove(s, "E1007", "z-locker"); // 仍被拦（访客在走廊）
  check("陪同：交接前仍不可独行", !ok(r));
  r = attemptMove(s, "V2002", "z-locker"); // 成组退回 L0
  check("陪同：成组退回更衣区", ok(r));
  s = r.state;
  r = exitFacility(s, "V2002"); // 访客先离场
  check("陪同：访客在 L0 可先离场", ok(r));
  s = r.state;
  r = exitFacility(s, "E1007"); // 陪同人随后离场
  check("陪同：访客离场后陪同人可离场", ok(r));
  s = r.state;
  check("陪同：两人均已在设施外", !currentZoneId(s, "V2002") && !currentZoneId(s, "E1007"));

  // 路径 B：当面交接（用另一对 E1001/V2001，初始同在 photo）
  // 先把 E1003 调到 photo 才能当面交接
  r = attemptMove(s, "E1003", "z-photo"); // 走廊 -> photo，容量允许
  check("交接：候选陪同人进入访客所在区", ok(r));
  s = r.state;
  r = handoverEscort(s, "V2001", "E1003");
  check("交接：同区员工可接手", ok(r));
  s = r.state;
  const v = personByBadge(s, "V2001")!;
  check("交接：访客陪同人已更新为 E1003", v.escortBadge === "E1003");
  // 非陪同人想把 V2001 带走？用 E1001 独行：现已无陪同责任，可离开 photo
  r = attemptMove(s, "E1001", "z-corridor");
  check("交接：原陪同人交接后可自由离开", ok(r));
  s = r.state;
  // 访客移动现在跟随新陪同人 E1003（同在 photo）-> 成组去走廊
  r = attemptMove(s, "V2001", "z-corridor");
  check("交接：访客随新陪同人成组移动", ok(r) && currentZoneId(r.state, "E1003") === "z-corridor");
  s = r.state;
  // 非同区不能交接：把访客与外人错开
  r = handoverEscort(s, "V2001", "E1008"); // E1008 在 locker
  check("交接：新陪同人不在同区被拒", !ok(r));
  invariantsHold(s, "访客陪同");
}

/* 6. 紧急封锁：禁止进入、只许离场；清点滞留与最近位置 */
{
  let s = seedState();
  let r = setLockdown(s, true, "气体报警");
  check("封锁：可启动", ok(r));
  s = r.state;
  check("封锁：状态位为真", s.locked === true);
  r = enterFacility(s, "E1004"); // 即便补过资质？此处未补，封锁应优先拦截
  check("封锁：外部人员禁止进入", !ok(r));
  // 向内移动被禁
  r = attemptMove(s, "E1003", "z-photo"); // corridor -> photo
  check("封锁：向内移动被禁", !ok(r));
  // 向外移动允许（只出不进）
  r = attemptMove(s, "E1003", "z-locker"); // corridor -> locker
  check("封锁：向外移动允许", ok(r));
  s = r.state;
  r = exitFacility(s, "E1003"); // 到 L0 可离场
  check("封锁：封锁中可离场", ok(r));
  s = r.state;
  check("封锁：离场者不在清点内", musterRows(s).every((row) => row.person.badge !== "E1003"));
  // 清点仍列出滞留者及最近位置
  const rows = musterRows(s);
  check("封锁：清点剩余 4 人", rows.length === 4, `got ${rows.length}`);
  const e1002 = rows.find((row) => row.person.badge === "E1002");
  check("封锁：滞留者最近位置正确", e1002?.zone.name === "核心工艺区 ISO 5");
  // 离场者的最近位置保留（lastSeenZone），便于追溯，但不计入滞留
  check("封锁：离场者保留最近位置记录", s.presence.lastSeenZone["E1003"] === "z-locker");
  // 解封恢复
  r = setLockdown(s, false, "");
  check("封锁：可解除", ok(r) && r.state.locked === false);
  s = r.state;
  r = setQualification(s, "E1005", "trained", true);
  s = r.state;
  r = enterFacility(s, "E1005");
  check("封锁：解封后可正常进入", ok(r));
  invariantsHold(s, "封锁");
}

/* 7. 离场规则：非 L0 不能直接离场；离场后可再次进入且不重复计数 */
{
  let s = seedState();
  let r = exitFacility(s, "E1002"); // 在核心区
  check("离场：深层区域不能直接离场", !ok(r));
  // 逐级退到 L0
  for (const z of ["z-photo", "z-corridor", "z-locker"] as const) {
    r = attemptMove(s, "E1002", z);
    check(`离场：退至 ${zoneById(s, z)!.name}`, ok(r));
    s = r.state;
  }
  check("离场：已退到更衣区", currentZoneId(s, "E1002") === "z-locker");
  r = exitFacility(s, "E1002");
  check("离场：L0 刷卡离场成功", ok(r));
  s = r.state;
  check("离场：离场后不在室内", !currentZoneId(s, "E1002"));
  r = exitFacility(s, "E1002"); // 重复离场
  check("离场：重复离场不计数", !ok(r));
  r = enterFacility(s, "E1002"); // 再次进入
  check("离场：离场后可再次进入", ok(r) && currentZoneId(r.state, "E1002") === "z-locker");
  invariantsHold(s, "离场");
}

/* 8. 容量编辑护栏 + 容量为 0 表示不限 */
{
  const s0 = seedState();
  let r = setCapacity(s0, "z-photo", 1); // 现有 2 人
  check("容量：不能低于当前在区人数", !ok(r));
  r = setCapacity(s0, "z-photo", 0);
  check("容量：可设为不限", ok(r));
  const s = r.state;
  // 不限容量：往里多放人也不报满
  let s2 = s;
  for (const badge of ["E1004", "E1005", "E1006", "E1007"]) {
    let rr = setQualification(s2, badge, badge === "E1004" ? "gowningQualified" : badge === "E1005" ? "trained" : "healthChecked", true);
    s2 = rr.state;
    // 直接放进场需要逐级，但这里只验证“满员判定”不触发：把容量0区作为进入口
  }
  // 更衣缓冲区仍有容量限制（6），将其也设为不限后可连续进入
  let rr = setCapacity(s2, "z-locker", 0);
  s2 = rr.state;
  const before = occupancy(s2, "z-locker");
  for (const badge of ["E1004", "E1005", "E1006", "E1007"]) {
    rr = enterFacility(s2, badge);
    check(`容量(不限)：${badge} 进入成功`, ok(rr), rr.verdict.reason);
    s2 = rr.state;
  }
  check("容量(不限)：实际人数增加", occupancy(s2, "z-locker") === before + 4);
  invariantsHold(s2, "容量不限");
}

/* 9. 登记新人员 + JSON 持久化往返后引擎仍可用 */
{
  let s = seedState();
  let r = addPerson(s, {
    name: "新员工·测试",
    badge: "e9999",
    type: "employee",
    trained: true,
    healthChecked: true,
    gowningQualified: true,
  });
  check("登记：工号大小写归一", ok(r) && !!personByBadge(r.state, "E9999"));
  s = r.state;
  r = addPerson(s, { name: "重复", badge: "E9999", type: "employee", trained: true, healthChecked: true, gowningQualified: true });
  check("登记：重复工号被拒", !ok(r));
  r = addPerson(s, { name: "无陪同访客", badge: "V9000", type: "visitor", trained: true, healthChecked: true, gowningQualified: true });
  check("登记：访客无陪同人被拒", !ok(r));

  // 模拟刷新：序列化 -> 反序列化 -> 继续操作
  const restored = JSON.parse(JSON.stringify(s)) as AccessState;
  const r2 = enterFacility(restored, "E9999");
  check("持久化：刷新载入后仍可刷卡进入", ok(r2) && currentZoneId(r2.state, "E9999") === "z-locker");
  check("持久化：历史流水完整保留并在其后追加", r2.state.logs.length === restored.logs.length + 1);
  check("持久化：流水序号在载入后继续递增", r2.state.logs[0].seq === r2.state.seq && r2.state.seq === restored.seq + 1);
  invariantsHold(r2.state, "持久化");
}

/* 10. 完整操作流水：成功/失败都记录，且严格递增、最新在前 */
{
  let s = seedState();
  const before = s.logs.length;
  const r1 = enterFacility(s, "E1004"); // 失败
  s = r1.state;
  const r2 = setQualification(s, "E1004", "gowningQualified", true);
  s = r2.state;
  const r3 = enterFacility(s, "E1004"); // 成功
  s = r3.state;
  check("流水：新增 3 条（含 1 失败 2 成功）", s.logs.length === before + 3);
  check("流水：最新在最前", s.logs[0].seq > s.logs[1].seq && s.logs[1].seq > s.logs[2].seq);
  check("流水：失败也被记录", s.logs[2].ok === false);
  check("流水：序号连续", s.logs[0].seq === s.seq);
}

console.log(`\n${failed === 0 ? "✅ 全部通过" : "❌ 存在失败"}：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
