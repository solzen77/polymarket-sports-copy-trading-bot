import type { Market, MarketDetails, TokenPrice } from "./models.js";
import type { Config, PolymarketConfig } from "./config.js";

const DEFAULT_TIMEOUT_MS = 10_000;

/** One row from Gamma GET /sports (league code, display label, tag used for event filters). */
export interface Sport {
  id: number;
  sport: string;
  /** Short label, usually uppercase (e.g. NBA). */
  label: string;
  /** Primary Gamma tag_id for this sport (filters /events?tag_id=...). */
  tagId: string;
}

/** One selectable market: URL slug, question text, optional parent event title. */
export interface LiveMarketOption {
  slug: string;
  question: string;
  eventTitle?: string;
}

/**
 * Trading bots: HTTP client for Gamma (markets/events) and CLOB (prices, books, orders).
 * Placing orders uses createClobClient() against CLOB, not raw fetch in this class.
 */
export class PolymarketApi {
  private gammaUrl: string;
  private clobUrl: string;
  private config: PolymarketConfig;

  constructor(config: PolymarketConfig) {
    this.gammaUrl = config.gamma_api_url.replace(/\/$/, "");
    this.clobUrl = config.clob_api_url.replace(/\/$/, "");
    this.config = config;
  }

  /** Gamma GET /sports — all sports/leagues Polymarket exposes. */
  async getSports(): Promise<Sport[]> {
    const url = `${this.gammaUrl}/sports`;
    const res = await fetch(url, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Failed to fetch sports (status: ${res.status})`);
    const arr = (await res.json()) as Array<{ id: number; sport: string; tags?: string }>;
    return arr.map((s) => {
      const tagId = (s.tags && s.tags.split(",").find((t) => t.trim() && t.trim() !== "1")) || "";
      return {
        id: s.id,
        sport: s.sport,
        label: s.sport.toUpperCase(),
        tagId: tagId.trim(),
      };
    });
  }

  /** Gamma GET /events?tag_id=... — active events for a sport; flattened to slug + question rows. */
  async getLiveMarketsByTagId(tagId: string, limit = 50): Promise<LiveMarketOption[]> {
    const url = `${this.gammaUrl}/events?tag_id=${encodeURIComponent(tagId)}&active=true&closed=false&limit=${limit}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Failed to fetch events for tag ${tagId} (status: ${res.status})`);
    const events = (await res.json()) as Array<{
      slug?: string;
      title?: string;
      markets?: Array<{ slug?: string; question?: string }>;
    }>;
    const options: LiveMarketOption[] = [];
    for (const ev of events) {
      const markets = ev.markets ?? [];
      const eventTitle = ev.title ?? ev.slug ?? "";
      if (markets.length === 0 && ev.slug) {
        options.push({ slug: ev.slug, question: eventTitle, eventTitle });
        continue;
      }
      for (const m of markets) {
        const slug = m.slug ?? ev.slug;
        if (slug) options.push({ slug, question: m.question ?? eventTitle, eventTitle });
      }
    }
    return options;
  }

  /** GET Gamma: market by slug. Tries /markets?slug= first, then /events/slug/ (first market). */
  async getMarketBySlug(slug: string): Promise<Market> {
    const byMarket = `${this.gammaUrl}/markets?slug=${encodeURIComponent(slug)}`;
    const resMarket = await fetch(byMarket, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    if (resMarket.ok) {
      const arr = (await resMarket.json()) as unknown[];
      if (Array.isArray(arr) && arr.length > 0) {
        const raw = arr[0] as Record<string, unknown>;
        return this.normalizeMarket(raw);
      }
    }
    const url = `${this.gammaUrl}/events/slug/${encodeURIComponent(slug)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Failed to fetch market by slug: ${slug} (status: ${res.status})`);
    const json = (await res.json()) as { markets?: unknown[] };
    const markets = json?.markets;
    if (!Array.isArray(markets) || markets.length === 0)
      throw new Error("Invalid market response: no markets array");
    const raw = markets[0] as Record<string, unknown>;
    return this.normalizeMarket(raw);
  }

  /** CLOB GET /markets/:conditionId — tokens, dates, etc. */
  async getMarket(conditionId: string): Promise<MarketDetails> {
    const url = `${this.clobUrl}/markets/${conditionId}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Failed to fetch market: ${conditionId} (status: ${res.status})`);
    const json = (await res.json()) as Record<string, unknown>;
    return json as unknown as MarketDetails;
  }

  /** CLOB GET /price — BUY side ≈ best bid, SELL side ≈ best ask; public endpoint. */
  async getPrice(tokenId: string, side: "BUY" | "SELL"): Promise<number> {
    const url = `${this.clobUrl}/price?side=${side}&token_id=${encodeURIComponent(tokenId)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Failed to fetch price (status: ${res.status})`);
    const json = (await res.json()) as { price?: string };
    const priceStr = json?.price;
    if (priceStr == null) throw new Error("Invalid price response");
    return Number(priceStr);
  }

  /** Best bid (BUY side) and ask (SELL side) for one outcome token; both requests run in parallel. */
  async getTokenPrice(tokenId: string): Promise<TokenPrice | null> {
    const [bidRes, askRes] = await Promise.allSettled([
      this.getPrice(tokenId, "BUY"),
      this.getPrice(tokenId, "SELL"),
    ]);
    const bid = bidRes.status === "fulfilled" ? bidRes.value : undefined;
    const ask = askRes.status === "fulfilled" ? askRes.value : undefined;
    if (bid !== undefined || ask !== undefined)
      return { token_id: tokenId, bid, ask };
    return null;
  }

  private normalizeMarket(raw: Record<string, unknown>): Market {
    return {
      conditionId: String(raw.conditionId ?? raw.condition_id ?? ""),
      id: raw.id != null ? String(raw.id) : undefined,
      question: String(raw.question ?? ""),
      slug: String(raw.slug ?? ""),
      endDateISO: raw.endDateISO != null ? String(raw.endDateISO) : raw.end_date_iso != null ? String(raw.end_date_iso) : undefined,
      endDateIso: raw.endDateIso != null ? String(raw.endDateIso) : undefined,
      active: Boolean(raw.active),
      closed: Boolean(raw.closed),
      tokens: Array.isArray(raw.tokens) ? (raw.tokens as Market["tokens"]) : undefined,
      clobTokenIds: raw.clobTokenIds != null ? String(raw.clobTokenIds) : undefined,
      outcomes: raw.outcomes != null ? String(raw.outcomes) : undefined,
    };
  }
}

/** Authenticated CLOB client for placing orders (uses private key; Polygon chain id 137). */
export async function createClobClient(config: Config): Promise<import("@polymarket/clob-client").ClobClient> {
  const { ClobClient } = await import("@polymarket/clob-client");
  const { Wallet } = await import("@ethersproject/wallet");
  const host = config.polymarket.clob_api_url.replace(/\/$/, "");
  const chainId = 137 as import("@polymarket/clob-client").Chain; // Polygon mainnet
  const privateKey = config.polymarket.private_key;
  if (!privateKey)
    throw new Error("private_key is required in config for CLOB client");
  const pk = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const signer = new Wallet(pk);
  const funder = config.polymarket.proxy_wallet_address ?? "";
  const signatureType = config.polymarket.signature_type ?? (funder ? 1 : 0);
  let creds: import("@polymarket/clob-client").ApiKeyCreds;
  if (config.polymarket.api_key && config.polymarket.api_secret && config.polymarket.api_passphrase) {
    creds = {
      key: config.polymarket.api_key,
      secret: config.polymarket.api_secret,
      passphrase: config.polymarket.api_passphrase,
    };
  } else {
    const tempClient = new ClobClient(host, chainId, signer);
    creds = await tempClient.createOrDeriveApiKey();
  }
  return new ClobClient(host, chainId, signer, creds, signatureType, funder);
}
