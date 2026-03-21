import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

export interface PolymarketConfig {
  gamma_api_url: string;
  clob_api_url: string;
  api_key?: string;
  api_secret?: string;
  api_passphrase?: string;
  private_key?: string;
  proxy_wallet_address?: string;
  /** CLOB signer mode: 0 = EOA wallet, 1 = Polymarket proxy, 2 = Gnosis Safe. */
  signature_type?: number;
}

export interface TradingConfig {
  slug?: string;
  continuous: boolean;
  check_interval_ms: number;
  trailing_stop_point: number;
  trailing_shares?: number;
  fixed_trade_amount: number;
  min_time_remaining_seconds?: number;
  sell_price: number;
  [key: string]: unknown;
}

/** Copy-trading bot: mirror other users' trades on chosen markets. */
export interface CopyTradingConfig {
  /** Market URL slugs to watch (same strings as the live-slugs CLI / Polymarket URLs). */
  slugs: string[];
  /** Proxy wallet addresses (0x...) of traders to follow. */
  traders: string[];
  /** How often to poll for new trades, milliseconds (default 3000). */
  poll_interval_ms?: number;
  /** Notional USD size each time you copy a trade (default 5). */
  copy_trade_amount_usd?: number;
  /** If true, print what would be traded but do not send real orders. */
  simulation?: boolean;
}

export interface Config {
  polymarket: PolymarketConfig;
  trading: TradingConfig;
  /** Set when using the copy-trading bot (config file or COPY_TRADING_* env). */
  copyTrading?: CopyTradingConfig;
}

const defaultPolymarket: PolymarketConfig = {
  gamma_api_url: "https://gamma-api.polymarket.com",
  clob_api_url: "https://clob.polymarket.com",
  api_key: undefined,
  api_secret: undefined,
  api_passphrase: undefined,
  private_key: undefined,
  proxy_wallet_address: undefined,
  signature_type: undefined,
};

const defaultTrading: TradingConfig = {
  slug: undefined,
  continuous: false,
  check_interval_ms: 1000,
  trailing_stop_point: 0.03,
  trailing_shares: 10,
  fixed_trade_amount: 1,
  min_time_remaining_seconds: 30,
  sell_price: 0.99,
};

function readEnv(key: string): string | undefined {
  const v = process.env[key];
  if (v == null) return undefined;
  const t = String(v).trim();
  return t.length ? t : undefined;
}

function parseEnvBool(v: string | undefined): boolean | undefined {
  if (!v) return undefined;
  const x = v.trim().toLowerCase();
  if (x === "1" || x === "true" || x === "yes" || x === "y" || x === "on") return true;
  if (x === "0" || x === "false" || x === "no" || x === "n" || x === "off") return false;
  return undefined;
}

function parseEnvNum(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseEnvCsv(v: string | undefined): string[] | undefined {
  if (!v) return undefined;
  const arr = v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length ? arr : undefined;
}

function loadConfigFromEnv(): Config | null {
  const gamma = readEnv("GAMMA_API_URL") ?? readEnv("POLYMARKET_GAMMA_API_URL");
  const clob = readEnv("CLOB_API_URL") ?? readEnv("CLOB_API_BASE") ?? readEnv("POLYMARKET_CLOB_API_URL");
  const tradingSlug = readEnv("TRADING_SLUG");

  const hasAny =
    Boolean(gamma || clob || tradingSlug) ||
    Boolean(readEnv("POLYMARKET_API_KEY") || readEnv("POLYMARKET_API_SECRET") || readEnv("POLYMARKET_PRIVATE_KEY")) ||
    Boolean(readEnv("COPY_TRADING_SLUGS") || readEnv("COPY_TRADING_TRADERS"));

  if (!hasAny) return null;

  const polymarket: PolymarketConfig = {
    ...defaultPolymarket,
    gamma_api_url: gamma ?? defaultPolymarket.gamma_api_url,
    clob_api_url: clob ?? defaultPolymarket.clob_api_url,
    api_key: readEnv("POLYMARKET_API_KEY") ?? defaultPolymarket.api_key,
    api_secret: readEnv("POLYMARKET_API_SECRET") ?? defaultPolymarket.api_secret,
    api_passphrase: readEnv("POLYMARKET_API_PASSPHRASE") ?? defaultPolymarket.api_passphrase,
    private_key: readEnv("POLYMARKET_PRIVATE_KEY") ?? defaultPolymarket.private_key,
    proxy_wallet_address: readEnv("POLYMARKET_PROXY_WALLET_ADDRESS") ?? defaultPolymarket.proxy_wallet_address,
    signature_type: parseEnvNum(readEnv("POLYMARKET_SIGNATURE_TYPE")) ?? defaultPolymarket.signature_type,
  };

  const trading: TradingConfig = {
    ...defaultTrading,
    slug: tradingSlug ?? defaultTrading.slug,
    continuous: parseEnvBool(readEnv("TRADING_CONTINUOUS")) ?? defaultTrading.continuous,
    check_interval_ms: parseEnvNum(readEnv("TRADING_CHECK_INTERVAL_MS")) ?? defaultTrading.check_interval_ms,
    trailing_stop_point: parseEnvNum(readEnv("TRADING_TRAILING_STOP_POINT")) ?? defaultTrading.trailing_stop_point,
    trailing_shares: parseEnvNum(readEnv("TRADING_TRAILING_SHARES")) ?? defaultTrading.trailing_shares,
    fixed_trade_amount: parseEnvNum(readEnv("TRADING_FIXED_TRADE_AMOUNT")) ?? defaultTrading.fixed_trade_amount,
    min_time_remaining_seconds:
      parseEnvNum(readEnv("TRADING_MIN_TIME_REMAINING_SECONDS")) ?? defaultTrading.min_time_remaining_seconds,
    sell_price: parseEnvNum(readEnv("TRADING_SELL_PRICE")) ?? defaultTrading.sell_price,
  };

  const copySlugs = parseEnvCsv(readEnv("COPY_TRADING_SLUGS"));
  const copyTraders = parseEnvCsv(readEnv("COPY_TRADING_TRADERS"));
  const copyTrading: CopyTradingConfig | undefined =
    copySlugs && copyTraders
      ? {
          slugs: copySlugs,
          traders: copyTraders,
          poll_interval_ms: parseEnvNum(readEnv("COPY_TRADING_POLL_INTERVAL_MS")),
          copy_trade_amount_usd: parseEnvNum(readEnv("COPY_TRADING_AMOUNT_USD")),
          simulation: parseEnvBool(readEnv("COPY_TRADING_SIMULATION")),
        }
      : undefined;

  return { polymarket, trading, copyTrading };
}

export function loadConfig(configPath: string): Config {
  const envConfig = loadConfigFromEnv();
  if (envConfig) return envConfig;

  const path = configPath.startsWith("/") ? configPath : join(process.cwd(), configPath);
  if (existsSync(path)) {
    const content = readFileSync(path, "utf-8");
    const parsed = JSON.parse(content) as Partial<Config>;
    return {
      polymarket: { ...defaultPolymarket, ...parsed.polymarket },
      trading: { ...defaultTrading, ...parsed.trading },
      copyTrading: parsed.copyTrading,
    };
  }

  const config: Config = {
    polymarket: defaultPolymarket,
    trading: defaultTrading,
  };
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
  return config;
}

export interface Args {
  simulation: boolean;
  noSimulation: boolean;
  config: string;
  /** If set, print sports + live slugs then exit. Use optional filter string (e.g. nba) to narrow the list. */
  listSlugs?: string;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { simulation: true, noSimulation: false, config: "config.json" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-simulation" || a === "-n") {
      args.noSimulation = true;
    } else if ((a === "--simulation" || a === "-s") && argv[i + 1] !== "false") {
      args.simulation = true;
    } else if ((a === "-c" || a === "--config") && argv[i + 1]) {
      args.config = argv[++i];
    } else if (a === "--list-slugs" || a.startsWith("--list-slugs=")) {
      args.listSlugs = a === "--list-slugs" ? "" : a.slice("--list-slugs=".length).trim().toLowerCase();
    }
  }
  return args;
}

export function isSimulation(args: Args): boolean {
  return args.noSimulation ? false : args.simulation;
}
