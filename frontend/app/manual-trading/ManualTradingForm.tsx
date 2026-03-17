"use client";

import { useState } from "react";
import Link from "next/link";

export function ManualTradingForm() {
  const [slug, setSlug] = useState("");

  return (
    <div className="rounded-lg border border-slate-800 bg-surface/80 p-4">
      <label className="block text-xs font-medium text-slate-300">Market slug</label>
      <input
        type="text"
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        placeholder="e.g. will-the-oklahoma-city-thunder-win-the-2026-nba-finals"
        className="mt-1 w-full rounded border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-200 placeholder-slate-500"
      />
      <div className="mt-3 flex gap-2">
        <Link
          href={slug.trim() ? `/markets/${encodeURIComponent(slug.trim())}` : "#"}
          className={`rounded px-4 py-2 text-sm ${slug.trim() ? "bg-accent text-white hover:bg-accent-soft" : "cursor-not-allowed bg-slate-700 text-slate-500"}`}
        >
          View market & chart
        </Link>
        <a
          href={`https://polymarket.com/event/${slug.trim()}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          Open on Polymarket
        </a>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        To place orders from this app, the backend would need to expose order endpoints. For now use{" "}
        <code className="rounded bg-slate-800 px-1">npm run manual-trading:live -- &lt;slug&gt;</code> in the repo root.
      </p>
    </div>
  );
}
