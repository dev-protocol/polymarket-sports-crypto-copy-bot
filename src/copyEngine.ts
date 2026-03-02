/**
 * Copy engine: place an order at sizePercent of the trade size.
 * Runs in the same process; does not await order placement so RTDS is not blocked.
 */
import type { ActivityTrade } from "./rtds.js";
import type { PlaceResult } from "./clob.js";
import { getConfig, isCopyEnabled } from "./config.js";
import { placeCopyOrder } from "./clob.js";

export type CopyLog = (msg: string) => void;
export type OnCopyPlaced = (trade: ActivityTrade, copySize: number, result: PlaceResult) => void;

export function onTrade(trade: ActivityTrade, log: CopyLog, onCopyPlaced?: OnCopyPlaced): void {
  if (!isCopyEnabled()) return;

  const config = getConfig();
  const pct = Math.max(0, Math.min(1000, config.sizePercent)) / 100;
  let copySize = trade.size * pct;
  if (copySize <= 0) return;

  copySize = Math.max(copySize, 0.01);

  void (async () => {
    const result = await placeCopyOrder(trade, copySize, log);
    onCopyPlaced?.(trade, copySize, result);
  })();
}
