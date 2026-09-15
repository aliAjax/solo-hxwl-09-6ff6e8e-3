import React from "react";
import { renderToString } from "react-dom/server";
import App from "../src/App";
import InspectionDashboard from "../src/InspectionDashboard";

// localStorage 在 Node 不存在：storage 的 try/catch 应回落到示例数据
// React SSR 会在静态文本与表达式之间插入 <!-- -->，断言前先去掉注释
const strip = (h: string) => h.replace(/<!--.*?-->/g, "");
const html = strip(renderToString(React.createElement(App)));
const checks: [string, boolean][] = [
  ["默认渲染通行台（默认页签）", html.includes("人员通行") && html.includes("启动紧急封锁")],
  ["刷卡输入默认工号 E1004", html.includes("E1004")],
  ["区域层级 L0..L3 渲染", ["L0", "L1", "L2", "L3"].every((l) => html.includes(l))],
  ["示例在室人员渲染（李晓敏/王建国）", html.includes("李晓敏") && html.includes("王建国")],
  ["操作流水渲染（含种子拒绝记录）", html.includes("重复刷卡") || html.includes("更衣资格未认证")],
  ["清点面板渲染", html.includes("应急清点") || html.includes("实时清点")],
];

const board = strip(renderToString(React.createElement(InspectionDashboard)));
checks.push(["原有看板完好", board.includes("半导体洁净室巡检") && board.includes("CR-1201")]);
checks.push(["原有看板指标在", board.includes("粒子异常") && board.includes("近期记录")]);

let fail = 0;
for (const [label, cond] of checks) {
  console.log(`${cond ? "✓" : "✕"} ${label}`);
  if (!cond) fail++;
}
console.log(`\n${fail === 0 ? "✅ 渲染检查全部通过" : "❌ 渲染失败 " + fail}`);
process.exit(fail ? 1 : 0);
