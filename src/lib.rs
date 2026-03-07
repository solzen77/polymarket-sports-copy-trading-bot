pub mod api;
pub mod clob_sdk;
pub mod detector;
pub mod config;
pub mod models;
pub mod monitor;
pub mod simulation;
pub mod trader;

// Re-export commonly used types
pub use api::PolymarketApi;
pub use config::Config;
pub use models::TokenPrice;

/// Log a trading event with timestamp to stderr.
pub fn log_trading_event(event: &str) {
    eprintln!("[{}] {}", chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ"), event);
}

/// Log a line to stderr (replaces previous history logging).
#[macro_export]
macro_rules! log_println {
    ($($arg:tt)*) => { eprintln!($($arg)*); };
}
