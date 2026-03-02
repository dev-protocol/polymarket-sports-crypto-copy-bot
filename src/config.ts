/**
 * In-memory copy-trade config. No persistence (restart clears).
 * privateKey is never returned from getConfig(); use hasPrivateKey and getPrivateKey().
 */
export interface CopyConfig {
  sizePercent: number;
  hasPrivateKey: boolean;
}

const DEFAULT: CopyConfig = {
  sizePercent: 100,
  hasPrivateKey: false,
};

let state: CopyConfig & { privateKey?: string } = { ...DEFAULT };

export function getConfig(): CopyConfig {
  return {
    sizePercent: state.sizePercent,
    hasPrivateKey: Boolean(state.privateKey && state.privateKey.trim().startsWith("0x")),
  };
}

export function getPrivateKey(): string | undefined {
  const pk = state.privateKey?.trim();
  return pk && pk.startsWith("0x") ? pk : undefined;
}

export function setConfig(partial: Partial<CopyConfig & { privateKey?: string }>): CopyConfig {
  if (partial.sizePercent !== undefined) {
    const p = Number(partial.sizePercent);
    state.sizePercent = Number.isFinite(p) ? Math.max(0, Math.min(1000, p)) : state.sizePercent;
  }
  if (partial.privateKey !== undefined) {
    const v = String(partial.privateKey).trim();
    state.privateKey = v.length > 0 ? v : undefined;
  }
  return getConfig();
}

export function isCopyEnabled(): boolean {
  return state.sizePercent > 0;
}
