/**
 * Polymarket CLOB client for placing copy orders. Lazy-init using key from config (UI) or env.
 * Keeps heartbeat when active. Ensures max allowances (USDC.e + CTF) when client is first created.
 */
import { Wallet } from "ethers";
import { ClobClient, OrderType, Side } from "@polymarket/clob-client";
import type { ActivityTrade } from "./rtds.js";
import { getPrivateKey } from "./config.js";
import { ensureAllowances } from "./allowances.js";

const CLOB_HOST = process.env.CLOB_HOST ?? "https://clob.polymarket.com";
const CHAIN_ID = parseInt(process.env.CHAIN_ID ?? "137", 10);

let client: ClobClient | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatId: string = "";

/** For UI: whether allowances have been ensured after client was created. */
let allowanceStatus: "ok" | "pending" | null = null;

/** Last allowance error message for UI alert. */
let lastAllowanceError: string | null = null;

/** Map RPC/gas errors to a user-friendly message for the UI. */
function allowanceErrorForUi(raw: string): string {
  const s = raw.toLowerCase();
  if (
    s.includes("gas price below minimum") ||
    s.includes("gas tip cap") ||
    s.includes("insufficient funds") ||
    s.includes("not enough")
  ) {
    return "Not enough POL in wallet. Add at least 20 POL to pay for gas (approval transactions).";
  }
  return raw;
}

export function getAllowanceStatus(): "ok" | "pending" | null {
  return allowanceStatus;
}

export function getAllowanceError(): string | null {
  return lastAllowanceError;
}

/** Run allowances only (no CLOB client). Used on UI refresh. */
export async function runAllowancesIfNeeded(): Promise<void> {
  if (allowanceStatus === "ok") return;
  lastAllowanceError = null;
  const pk = resolvePrivateKey();
  if (!pk) return;
  allowanceStatus = "pending";
  try {
    const signer = new Wallet(pk);
    const result = await ensureAllowances(signer, (msg) => console.log(msg));
    if (result.ok) {
      allowanceStatus = "ok";
    } else {
      allowanceStatus = null;
      lastAllowanceError = allowanceErrorForUi(result.error ?? "Allowance failed");
    }
  } catch (e) {
    allowanceStatus = null;
    lastAllowanceError = allowanceErrorForUi(e instanceof Error ? e.message : String(e));
    console.error("[CLOB] runAllowancesIfNeeded failed:", e);
  }
}

/** Create CLOB client and run allowances. Used when bot is started. */
export async function ensureClobReady(): Promise<ClobClient | null> {
  return getClient();
}

export interface PlaceResult {
  ok: boolean;
  orderID?: string;
  status?: string;
  error?: string;
}

function resolvePrivateKey(): string | undefined {
  const fromConfig = getPrivateKey();
  if (fromConfig) return fromConfig;
  const fromEnv = process.env.PRIVATE_KEY?.trim();
  return fromEnv && fromEnv.startsWith("0x") ? fromEnv : undefined;
}

async function getClient(): Promise<ClobClient | null> {
  if (client) return client;
  const pk = resolvePrivateKey();
  if (!pk) {
    console.warn("[CLOB] No private key set (UI or PRIVATE_KEY env); copy orders disabled.");
    return null;
  }
  try {
    const signer = new Wallet(pk);
    const tempClient = new ClobClient(CLOB_HOST, CHAIN_ID as 137, signer);
    const creds = await tempClient.createOrDeriveApiKey();
    client = new ClobClient(
      CLOB_HOST,
      CHAIN_ID as 137,
      signer,
      creds,
      0, // EOA
      signer.address,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      60_000,
      true
    );
    /* Approval runs only when user presses Start or refreshes UI, not when client is created. */
    startHeartbeat();
    return client;
  } catch (e) {
    console.error("[CLOB] Failed to init client:", e);
    return null;
  }
}

function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(async () => {
    if (!client) return;
    try {
      const resp = await client.postHeartbeat(heartbeatId || undefined);
      heartbeatId = (resp as { heartbeat_id?: string }).heartbeat_id ?? "";
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status;
      const msg = e instanceof Error ? e.message : String(e);
      if (status === 401 || (typeof msg === "string" && msg.includes("Invalid api key"))) {
        console.warn("[CLOB] API key rejected (401). Clearing client. Ensure PRIVATE_KEY is a Polymarket-linked wallet. See README.");
        closeClob();
        return;
      }
      console.error("[CLOB] Heartbeat error:", e);
    }
  }, 5000);
}

/** Extract a short message from CLOB/axios-style errors for logging. */
function shortClobError(e: unknown): string {
  if (e && typeof e === "object") {
    const err = e as { response?: { status?: number; data?: { error?: string } }; message?: string };
    if (err.response?.data?.error) {
      const status = err.response.status ?? 400;
      return `${status}: ${err.response.data.error}`;
    }
    if (typeof err.message === "string" && err.message.length < 120) return err.message;
    if (typeof err.message === "string") return err.message.slice(0, 100) + "…";
  }
  const s = e instanceof Error ? e.message : String(e);
  return s.length > 120 ? s.slice(0, 100) + "…" : s;
}

export async function placeCopyOrder(
  trade: ActivityTrade,
  copySize: number,
  log: (msg: string) => void
): Promise<PlaceResult> {
  if (!trade.asset || copySize <= 0) {
    return { ok: false, error: "Missing asset or invalid size" };
  }
  const c = await getClient();
  if (!c) return { ok: false, error: "CLOB client not available" };

  try {
    const tickSize = await c.getTickSize(trade.asset);
    const negRisk = await c.getNegRisk(trade.asset);
    const tickStr = typeof tickSize === "string" ? tickSize : "0.01";

    const response = await c.createAndPostOrder(
      {
        tokenID: trade.asset,
        price: trade.price,
        size: copySize,
        side: trade.side === "BUY" ? Side.BUY : Side.SELL,
      },
      { tickSize: tickStr, negRisk },
      OrderType.GTC
    );

    const orderID = (response as { orderID?: string }).orderID;
    const status = (response as { status?: string }).status;
    log(`Copy order placed: ${orderID ?? "—"} status=${status ?? "—"}`);
    return { ok: true, orderID, status };
  } catch (e: unknown) {
    const errMsg = shortClobError(e);
    const status = (e as { response?: { status?: number } })?.response?.status ?? (e as { status?: number })?.status;
    log(`Copy order failed: ${errMsg}`);
    if (status === 401 || (typeof errMsg === "string" && errMsg.includes("Invalid api key"))) {
      closeClob();
    }
    return { ok: false, error: errMsg };
  }
}

export function closeClob(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  heartbeatId = "";
  client = null;
  allowanceStatus = null;
  lastAllowanceError = null;
}

/** Call when private key is updated via UI so next order uses the new key. */
export function resetClobClient(): void {
  closeClob();
}
