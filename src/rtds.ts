import WebSocket from "ws";

const RTDS_URL = "wss://ws-live-data.polymarket.com";
const PING_INTERVAL_MS = 15000;
const RETRY_BASE_MS = 10000;
const RETRY_MAX_MS = 60000;
const RETRY_429_BASE_MS = 10000;
const RETRY_429_MAX_MS = 600000;

export interface ActivityTrade {
  asset: string;
  conditionId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  outcome: string;
  outcomeIndex: number;
  slug: string;
  eventSlug: string;
  title: string;
  timestamp: number;
  transactionHash?: string;
  proxyWallet: string;
  name?: string;
  pseudonym?: string;
}

export interface RtdsMessage {
  topic: string;
  type: string;
  timestamp: number;
  payload: unknown;
}

type ActivityHandler = (trade: ActivityTrade) => void;

export function connectRtdsActivity(onTrade: ActivityHandler): { close: () => void } {
  let ws: WebSocket | null = null;
  let pingInterval: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryCount = 0;
  let lastWas429 = false;
  let closed = false;

  function clearRetry() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function connect() {
    if (closed) return;
    /* Filter by TARGET_ADDRESS from env (wallet, name, or pseudonym). Empty = show all. Use as-is, no lowercase. */
    const targetAddress = (process.env.TARGET_ADDRESS ?? "").trim();
    ws = new WebSocket(RTDS_URL);

    ws.on("open", () => {
      retryCount = 0;
      ws!.send(
        JSON.stringify({
          action: "subscribe",
          subscriptions: [
            { topic: "activity", type: "trades" },
            { topic: "activity", type: "orders_matched" },
          ],
        })
      );
    });

    ws.on("message", (data: Buffer | string) => {
      const raw = data.toString();
      if (raw === "PONG") return;

      try {
        const msg = JSON.parse(raw) as RtdsMessage;
        /* Activity topic types per Polymarket RTDS: "trades" | "orders_matched" (no "orders_placed"). */
        if (msg.topic === "activity" && (msg.type === "trades" || msg.type === "orders_matched")) {
          const p = msg.payload as Record<string, unknown>;
          /* One WS message → one trade → one UI update; process every message. */
          const trade: ActivityTrade = {
            asset: String(p.asset ?? ""),
            conditionId: String(p.conditionId ?? p.condition_id ?? ""),
            side: (p.side as "BUY" | "SELL") ?? "BUY",
            price: Number(p.price ?? 0),
            size: Number(p.size ?? 0),
            outcome: String(p.outcome ?? ""),
            outcomeIndex: Number(p.outcomeIndex ?? p.outcome_index ?? 0),
            slug: String(p.slug ?? ""),
            eventSlug: String(p.eventSlug ?? p.event_slug ?? ""),
            title: String(p.title ?? ""),
            timestamp: Number(p.timestamp ?? 0),
            transactionHash: p.transactionHash != null ? String(p.transactionHash) : undefined,
            proxyWallet: String(p.proxyWallet ?? p.proxy_wallet ?? ""),
            name: p.name != null ? String(p.name) : undefined,
            pseudonym: p.pseudonym != null ? String(p.pseudonym) : undefined,
          };
          const wallet = (trade.proxyWallet ?? "").trim();
          const name = (trade.name ?? "").trim();
          const pseudonym = (trade.pseudonym ?? "").trim();
          /* Wallet: compare case-insensitive (Ethereum addresses). Name/pseudonym: exact match (preserve env casing). */
          const matches =
            !targetAddress ||
            (wallet && wallet.toLowerCase() === targetAddress.toLowerCase()) ||
            name === targetAddress ||
            pseudonym === targetAddress;
          if (matches) onTrade(trade);
        }
      } catch {
        // ignore non-JSON or unexpected frames
      }
    });

    ws.on("error", (err: Error) => {
      const is429 = String(err.message).includes("429");
      if (is429) lastWas429 = true;
      console.error("[RTDS] WebSocket error:", err.message);
      if (is429) {
        console.warn("[RTDS] Polymarket rate limit (429). Will retry with backoff.");
      }
    });

    ws.on("close", (code: number, reason: Buffer) => {
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      ws = null;
      if (closed) return;
      console.error("[RTDS] WebSocket closed:", code, reason.toString());
      let delay: number;
      if (lastWas429 || code === 1006) {
        lastWas429 = false;
        delay = Math.min(RETRY_429_BASE_MS * Math.pow(2, Math.min(retryCount, 4)), RETRY_429_MAX_MS);
      } else {
        delay = Math.min(RETRY_BASE_MS * Math.pow(2, retryCount), RETRY_MAX_MS);
      }
      retryCount++;
      const sec = Math.round(delay / 1000);
      console.warn("[RTDS] Reconnecting in", sec, "s (attempt", retryCount, "). 429 = Polymarket rate limit; bot will retry automatically.");
      retryTimer = setTimeout(connect, delay);
    });

    pingInterval = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) ws.send("PING");
    }, PING_INTERVAL_MS);
  }

  connect();

  return {
    close() {
      closed = true;
      clearRetry();
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      if (ws) {
        ws.removeAllListeners();
        ws.close();
        ws = null;
      }
    },
  };
}
