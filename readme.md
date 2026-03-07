# Polymarket Sports Trailing Bot

A Rust bot for [Polymarket](https://polymarket.com) that trades **sports (binary) markets** by slug using a **trailing stop** strategy only. It monitors a single market’s two outcome tokens and buys when prices recover after a dip, then hedges by buying the opposite side.

---

## Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [Project Structure](#project-structure)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [CLOB SDK and credentials](#clob-sdk-and-credentials)
- [Command-Line Options](#command-line-options)
- [Simulation vs Live](#simulation-vs-live)
- [Finding a Market Slug](#finding-a-market-slug)
- [Security](#security)
- [Notes](#notes)
- [Support](#support)

---

## Overview

- **Target:** Binary (Yes/No) sports markets on Polymarket, identified by **slug** (e.g. `nfl-team-a-vs-team-b`).
- **Strategy:** Trailing stop only — no fixed trigger prices. The bot tracks both outcome tokens and buys when the ask price recovers to at least **lowest seen + trailing stop** (e.g. +3¢).
- **Flow:**  
  1. Trail both tokens; the first side that satisfies the recovery condition is bought.  
  2. Then trail the **opposite** token the same way and buy when it triggers.  
  3. **Once:** one pair of buys per market. **Continuous:** after both sides are bought, reset and repeat until the market ends.

---

## How It Works

### Trailing logic

- For each token the bot maintains a **low** (minimum ask seen) and **high** (maximum ask seen).
- **Trigger:** buy when current ask ≥ low + `trailing_stop_point` (e.g. `0.03` = 3¢).
- The bot buys the token whose price **dipped first and then recovered**; then it trails and buys the other token with the same rule.

### Internal states

| State            | Description |
|------------------|-------------|
| **WaitingFirst** | Tracking both tokens; waiting for the first side to trigger (ask ≥ low + trailing stop). |
| **FirstBuyPending** | First order submitted; no new triggers until it resolves. |
| **FirstBought** | First side filled; now trailing the opposite token only. |
| **Done** | Both sides bought. If `continuous: true`, state resets to **WaitingFirst** and the cycle repeats. |

### Execution

- Orders are placed as **market orders** via the Polymarket CLOB (Central Limit Order Book).
- In **simulation** mode, no real orders are sent; the bot logs what it would do.
- The bot exits when the market’s end time is reached (time remaining = 0) or you stop it (e.g. Ctrl+C).

---

## Project Structure

| Path | Description |
|------|-------------|
| `src/bin/main_sports_trailing.rs` | Entry point: loads config, fetches market by slug, runs the trailing state machine. |
| `src/trader.rs` | Order execution (market/limit), CLOB SDK calls, hedge logic, position tracking. |
| `src/api.rs` | Polymarket Gamma + CLOB HTTP API: auth, market by slug, market details, prices, order placement. |
| `src/config.rs` | CLI args and config types (`Config`, `PolymarketConfig`, `TradingConfig`). |
| `src/models.rs` | Market, Token, OrderBook, TokenPrice, OrderRequest, etc. |
| `src/clob_sdk.rs` | FFI to CLOB shared library (order signing, post limit/market, balance). |
| `src/detector.rs` | Buy opportunity types and token types (used by trader). |
| `src/monitor.rs` | Market monitoring and snapshots (used by other bots; sports bot uses API directly). |
| `src/simulation.rs` | Simulation tracker: positions, PnL, limit orders in simulation. |

---

## Requirements

- **Rust** 2021 (e.g. install via [rustup](https://rustup.rs)).
- **Polymarket CLOB SDK** in `lib/` and **valid config credentials** (see [CLOB SDK](#clob-sdk-live-mode-only)). Required for both simulation and live; simulation does not place real orders.

---

## Quick Start

| Binary | Description |
|--------|-------------|
| `main_sports_trailing` | Sports trailing bot (default) — slug-based, trailing only |

```bash
# Build
cargo build --release

# Simulation (no real orders; still requires CLOB SDK in lib/ and valid config credentials)
cargo run --release -- --simulation

# Live (same requirements; places real orders)
cargo run --release -- --no-simulation
```

Create `config.json` from `config.example.json`, set `trading.slug` to your market slug, and for live mode fill in Polymarket API credentials and (if needed) `private_key` / proxy settings.

---

## Configuration

Config file path is set with `--config <path>` (default: `config.json`). The sports trailing bot uses the following.

### Polymarket (API & auth)

| Field | Description |
|-------|-------------|
| `gamma_api_url` | Gamma API base URL (e.g. `https://gamma-api.polymarket.com`). |
| `clob_api_url` | CLOB API base URL (e.g. `https://clob.polymarket.com`). |
| `api_key` | Polymarket API key (required for live). |
| `api_secret` | Polymarket API secret. |
| `api_passphrase` | Polymarket API passphrase. |
| `private_key` | Private key for order signing (hex, with or without `0x`). |
| `proxy_wallet_address` | Optional proxy wallet address. |
| `signature_type` | `0` = EOA, `1` = POLY_PROXY, `2` = GNOSIS_SAFE. |

### Trading (sports trailing)

| Field | Description |
|-------|-------------|
| `slug` | **Required.** Market slug (e.g. `your-sports-market-slug`). |
| `continuous` | If `true`, after buying both sides the bot resets and trails/buys again until the market ends; if `false`, it buys each side once per market. |
| `trailing_stop_point` | Trailing stop in price units (e.g. `0.03` = 3¢). Trigger when ask ≥ lowest + this. |
| `trailing_shares` | Target number of shares per side (first and second buy). |
| `fixed_trade_amount` | Used if `trailing_shares` is not set; shares derived from this and price. |
| `check_interval_ms` | Polling interval in ms (e.g. `1000`). |
| `min_time_remaining_seconds` | Minimum seconds left before placing a new trade (default 30). Set to **0** to trade until market closure. |
| `sell_price` | Optional; used by other strategies; sports trailing focuses on buy-side trailing. |

Example minimal `config.json` for the sports bot:

```json
{
  "polymarket": {
    "gamma_api_url": "https://gamma-api.polymarket.com",
    "clob_api_url": "https://clob.polymarket.com",
    "api_key": "",
    "api_secret": "",
    "api_passphrase": "",
    "private_key": "",
    "proxy_wallet_address": "",
    "signature_type": 2
  },
  "trading": {
    "slug": "your-sports-market-slug",
    "continuous": false,
    "check_interval_ms": 1000,
    "trailing_stop_point": 0.03,
    "trailing_shares": 10.0,
    "fixed_trade_amount": 1.0,
    "min_time_remaining_seconds": 30,
    "sell_price": 0.99
  }
}
```

---

## CLOB SDK and credentials

**Both simulation and live** require the Polymarket CLOB SDK in `lib/` and valid API credentials in config. The bot authenticates the same way in both modes; only live mode places real orders.

- **Linux:** `lib/libclob_sdk.so`
- **macOS:** `lib/libclob_sdk.dylib` or `lib/libclob_sdk.so`
- **Windows:** `lib/clob_sdk.dll`

Override the library path with the **`LIBCOB_SDK_SO`** environment variable.

Build the CLOB SDK (e.g. from the official Polymarket CLOB client repo) with the client/order FFI and place the resulting shared library in `lib/`, or set `LIBCOB_SDK_SO` to its full path.

---

## Command-Line Options

| Option | Description |
|--------|-------------|
| `--simulation` | Run in simulation (default: true). Same CLOB SDK and credentials as live; no real orders. |
| `--no-simulation` | Run in live mode; places real orders. |
| `--config <path>` | Config file path (default: `config.json`). |

---

## Simulation vs Live

| Mode | CLOB SDK & credentials | Orders | Use case |
|------|------------------------|--------|----------|
| `--simulation` (default) | Required | None | Test auth and strategy without placing real orders. |
| `--no-simulation` | Required | Real market orders | Live trading. |

---

## Finding a Market Slug

1. Open the market on Polymarket in your browser.
2. The URL often looks like: `https://polymarket.com/event/<slug>` or `.../market/...`.
3. The **slug** is the URL segment that identifies the market (e.g. `nfl-team-a-vs-team-b`). Use this exact value for `trading.slug` in `config.json`.

---

## Security

- **Do not** commit `config.json` with real API keys, secrets, or private keys. Use `.gitignore` for `config.json`.
- Prefer **simulation** and small sizes when testing.
- Monitor logs and balances when running in production.

---

## Notes

- The bot runs until the market end time (time remaining = 0) or you stop it (e.g. Ctrl+C).
- Simulation mode logs trades but does not place orders.
- The first buy uses a minimum cost of $1 (see `MIN_FIRST_BUY_COST` in the binary) when deriving size from price; `trailing_shares` or `fixed_trade_amount` still apply as configured.

---

## Support

If you have any questions or would like a more customized app for specific use cases, please feel free to contact us at the contact information below.
- Discord: [@solzen77](https://discordapp.com/users/943821362387120129)
