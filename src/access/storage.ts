import { useCallback, useEffect, useRef, useState } from "react";
import { seedState } from "./seed";
import type { AccessState } from "./types";

const STORAGE_KEY = "hxwl-09-access-console-v1";

/** 刷新页面后状态、容量与完整操作流水仍在 */
export function loadState(): AccessState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as AccessState;
    // 最小结构校验，损坏则回落到示例数据
    if (
      parsed &&
      Array.isArray(parsed.zones) &&
      Array.isArray(parsed.people) &&
      Array.isArray(parsed.logs) &&
      parsed.presence &&
      typeof parsed.seq === "number"
    ) {
      return parsed;
    }
    return seedState();
  } catch {
    return seedState();
  }
}

export function saveState(state: AccessState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储满或隐私模式：忽略，本次会话内功能不受影响
  }
}

export function clearSaved(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function useAccessState() {
  const [state, setState] = useState<AccessState>(loadState);
  const ref = useRef(state);
  ref.current = state;

  useEffect(() => {
    saveState(state);
  }, [state]);

  /** 应用一个返回 {state, verdict} 的领域动作，并同步返回判定结果 */
  const apply = useCallback(
    <A extends unknown[], R extends { state: AccessState; verdict: { ok: boolean; reason: string } }>(
      fn: (prev: AccessState, ...args: A) => R,
      ...args: A
    ): R => {
      const result = fn(ref.current, ...args);
      setState(result.state);
      return result;
    },
    [],
  );

  const reset = useCallback(() => {
    clearSaved();
    const fresh = seedState();
    ref.current = fresh;
    setState(fresh);
  }, []);

  return { state, apply, reset };
}
