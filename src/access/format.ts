export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO -> MM-DD HH:mm:ss */
export function formatTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(
    d.getSeconds(),
  )}`;
}

/** HH:mm:ss */
export function formatClock(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** 停留时长描述 */
export function durationLabel(iso?: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "刚进入";
  if (min < 60) return `停留 ${min} 分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `停留 ${h} 小时 ${m} 分` : `停留 ${h} 小时`;
}
