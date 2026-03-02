# Polymarket Copy-trade Bot

![Polymarket Copy-trade bot](public/s.gif)

Express backend + HTML frontend. Streams activity via RTDS and places copy orders using the Polymarket CLOB API.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and set:
   - **`PRIVATE_KEY`** – Your wallet private key (0x…). Must be a **Polymarket-linked wallet** (see below).
   - **`POLYGON_RPC_URL`** (optional) – Polygon RPC (default: https://polygon-rpc.com).
3. `npm run build && npm start` (or `npx nodemon` for dev).

## "Unauthorized / Invalid api key" (401)

If you see **401 Unauthorized** or **Invalid api key** in the terminal or when placing copy orders:

- The CLOB client **creates/derives an API key** from your `PRIVATE_KEY` wallet. Polymarket rejects it if:
  1. **The wallet is not linked to Polymarket** – Use a wallet that you have used to sign in or trade on [Polymarket](https://polymarket.com). If you use email login, export the key from [reveal.magic.link/polymarket](https://reveal.magic.link/polymarket).
  2. **The key was revoked or restricted** – Create a new key by using a fresh wallet or re-linking the same wallet on Polymarket.
  3. **Region / API restrictions** – Polymarket may restrict CLOB API access in some regions or require additional verification.

After a 401, the bot clears the CLOB client and stops heartbeats. Fix the wallet/key and restart (or trigger a new copy) to try again.

## Env reference

| Variable           | Required | Description                                      |
|--------------------|----------|--------------------------------------------------|
| `PRIVATE_KEY`      | Yes      | EOA private key (0x…) for signing; must be Polymarket-linked. |
| `POLYGON_RPC_URL`  | No       | Polygon RPC URL (default: https://polygon-rpc.com). |
