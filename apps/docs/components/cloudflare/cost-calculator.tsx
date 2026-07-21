'use client';

import { cn } from '@/lib/cn';
import { useMemo, useState } from 'react';

/**
 * Cloudflare pricing constants (verified 2026-07-21):
 * - Workers Paid: https://developers.cloudflare.com/workers/platform/pricing/
 * - R2: https://developers.cloudflare.com/r2/pricing/
 * - Durable Objects: https://developers.cloudflare.com/durable-objects/platform/pricing/
 */
const PRICING = {
  workersBaseUsd: 5,
  workersIncludedRequests: 10_000_000,
  workersRequestPerMillion: 0.3,
  workersIncludedCpuMs: 30_000_000,
  workersCpuPerMillionMs: 0.02,
  r2IncludedGb: 10,
  r2GbMonth: 0.015,
  r2IncludedClassA: 1_000_000,
  r2ClassAPerMillion: 4.5,
  r2IncludedClassB: 10_000_000,
  r2ClassBPerMillion: 0.36,
  doIncludedRequests: 1_000_000,
  doRequestPerMillion: 0.15,
} as const;

/** Measured model inputs (see content/docs/cloudflare/benchmarks). */
const MODEL = {
  indexBytesPerDoc: 1390, // 13.87 MB snapshot per 10k docs, measured on R2
  rawBytesPerDoc: 340, // transient WAL footprint until rebuild GC
  warmCpuMsPer1kDocs: 0.4, // ~1.1ms @10k, ~40ms @89k measured
  coldCpuMsPerDoc: 0.005, // snapshot deserialize on a cold isolate (~0.5s @100k docs)
  batchSize: 100, // docs per /documents/batch call
  batchCpuMs: 30,
  rebuildThresholdOps: 500, // per shard, wrangler var REBUILD_THRESHOLD_OPS
  rebuildCpuMsPerDoc: 0.0625, // 96k docs rebuilt in ~6s CPU, measured
  walReadsPerRebuild: 10,
  metaGetsPerSearchUncached: 1, // per shard (+1 for the group)
  metaCacheHitRatio: 0.99, // with in-isolate meta cache enabled
} as const;

const COLORS = {
  base: 'oklch(0.60 0 0)',
  requests: 'oklch(0.65 0.15 250)',
  cpu: 'oklch(0.62 0.18 300)',
  storage: 'oklch(0.68 0.14 180)',
  classA: 'oklch(0.72 0.15 85)',
  classB: 'oklch(0.65 0.17 45)',
  durable: 'oklch(0.65 0.16 340)',
  total: 'oklch(0.62 0.17 155)',
} as const;

interface Inputs {
  docs: number;
  searches: number;
  writes: number;
  shards: number;
  coldPct: number;
  metaCache: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function suggestedShards(docs: number): number {
  return clamp(Math.round(docs / 25_000) || 1, 1, 32);
}

function compute(inputs: Inputs) {
  const { docs, searches, writes, shards, coldPct, metaCache } = inputs;

  const coldRatio = coldPct / 100;
  const batches = writes / MODEL.batchSize;
  const shardRebuilds = writes / MODEL.rebuildThresholdOps;

  // Workers CPU
  const warmCpuMs = Math.max(1, (docs / 1000) * MODEL.warmCpuMsPer1kDocs);
  const coldExtraCpuMs = docs * MODEL.coldCpuMsPerDoc;
  const searchCpuMs = searches * (warmCpuMs + coldRatio * coldExtraCpuMs);
  const batchCpuMs = batches * MODEL.batchCpuMs;
  const rebuildCpuMs = shardRebuilds * (docs / shards) * MODEL.rebuildCpuMsPerDoc;
  const totalCpuMs = searchCpuMs + batchCpuMs + rebuildCpuMs;

  // Workers requests
  const workerRequests = searches + batches + shardRebuilds * 2;

  // R2 operations
  const metaGetsPerSearch = metaCache
    ? (1 - MODEL.metaCacheHitRatio) * (shards + 1)
    : (shards + 1) * MODEL.metaGetsPerSearchUncached;
  const classB =
    searches * metaGetsPerSearch +
    searches * coldRatio * shards + // snapshot downloads on cold isolates
    shardRebuilds * MODEL.walReadsPerRebuild;
  const classA = batches * 2 + shardRebuilds * 2; // WAL segment + head, snapshot + meta
  const storageGb = (docs * (MODEL.indexBytesPerDoc + MODEL.rawBytesPerDoc)) / 1e9;

  // Durable Objects (coordinator: one call per write batch + rebuild coordination)
  const doRequests = batches + shardRebuilds * 2;

  // Costs
  const requestsCost =
    (Math.max(0, workerRequests - PRICING.workersIncludedRequests) / 1e6) *
    PRICING.workersRequestPerMillion;
  const cpuCost =
    (Math.max(0, totalCpuMs - PRICING.workersIncludedCpuMs) / 1e6) *
    PRICING.workersCpuPerMillionMs;
  const r2StorageCost = Math.max(0, storageGb - PRICING.r2IncludedGb) * PRICING.r2GbMonth;
  const r2ClassACost =
    (Math.max(0, classA - PRICING.r2IncludedClassA) / 1e6) * PRICING.r2ClassAPerMillion;
  const r2ClassBCost =
    (Math.max(0, classB - PRICING.r2IncludedClassB) / 1e6) * PRICING.r2ClassBPerMillion;
  const doCost =
    (Math.max(0, doRequests - PRICING.doIncludedRequests) / 1e6) * PRICING.doRequestPerMillion;

  const usageCost =
    requestsCost + cpuCost + r2StorageCost + r2ClassACost + r2ClassBCost + doCost;

  return {
    workerRequests,
    totalCpuMs,
    classA,
    classB,
    storageGb,
    doRequests,
    warmCpuMs,
    coldExtraCpuMs,
    breakdown: [
      {
        label: 'Workers base plan',
        color: COLORS.base,
        cost: PRICING.workersBaseUsd,
        usage: 'includes 10M req + 30M CPU-ms',
      },
      {
        label: 'Workers requests',
        color: COLORS.requests,
        cost: requestsCost,
        usage: `${formatCompact(workerRequests)} req`,
      },
      {
        label: 'Workers CPU',
        color: COLORS.cpu,
        cost: cpuCost,
        usage: `${formatCompact(totalCpuMs)} CPU-ms`,
      },
      {
        label: 'R2 storage',
        color: COLORS.storage,
        cost: r2StorageCost,
        usage:
          storageGb < 1 ? `${(storageGb * 1000).toFixed(0)} MB` : `${storageGb.toFixed(2)} GB`,
      },
      {
        label: 'R2 Class A (writes)',
        color: COLORS.classA,
        cost: r2ClassACost,
        usage: `${formatCompact(classA)} ops`,
      },
      {
        label: 'R2 Class B (reads)',
        color: COLORS.classB,
        cost: r2ClassBCost,
        usage: `${formatCompact(classB)} ops`,
      },
      {
        label: 'Durable Objects',
        color: COLORS.durable,
        cost: doCost,
        usage: `${formatCompact(doRequests)} req`,
      },
    ],
    total: PRICING.workersBaseUsd + usageCost,
    perMillionSearches: ((PRICING.workersBaseUsd + usageCost) / searches) * 1e6,
    fitsFreePlan: warmCpuMs <= 10 && searches <= 3_000_000 && writes <= 3_000_000,
    exceedsCpuLimit: warmCpuMs + coldExtraCpuMs > 300_000,
  };
}

function formatCompact(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return `${Math.round(value)}`;
}

function formatUsd(value: number): string {
  if (value >= 1000) return `$${Math.round(value).toLocaleString()}`;
  return `$${value.toFixed(2)}`;
}

function toSlider(value: number, min: number, max: number): number {
  return ((Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min))) * 100;
}

function fromSlider(pos: number, min: number, max: number): number {
  const value = Math.exp(Math.log(min) + (pos / 100) * (Math.log(max) - Math.log(min)));
  // Round to 2 significant digits for readable values
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.round(value / (magnitude / 10)) * (magnitude / 10);
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  log = true,
  format,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  log?: boolean;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const pos = log ? toSlider(value, min, max) : ((value - min) / (max - min)) * 100;
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-fd-muted-foreground">
          {label}
          {hint ? <span className="ml-1 text-fd-muted-foreground/60">{hint}</span> : null}
        </span>
        <span className="rounded-md bg-fd-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-fd-primary">
          {format(value)}
        </span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={pos}
        onChange={(event) => {
          const next = Number.parseFloat(event.target.value);
          onChange(
            log ? fromSlider(next, min, max) : Math.round(min + (next / 100) * (max - min)),
          );
        }}
        className="mt-2 w-full accent-fd-primary"
      />
    </label>
  );
}

export function CostCalculator() {
  const [docs, setDocs] = useState(5_000);
  const [searches, setSearches] = useState(10_000_000);
  const [writes, setWrites] = useState(5_000);
  const [shards, setShards] = useState(5);
  const [coldPct, setColdPct] = useState(4);
  const [metaCache, setMetaCache] = useState(true);

  const result = useMemo(
    () => compute({ docs, searches, writes, shards, coldPct, metaCache }),
    [docs, searches, writes, shards, coldPct, metaCache],
  );

  const maxRowCost = Math.max(...result.breakdown.map((row) => row.cost));

  return (
    <div className="not-prose overflow-hidden rounded-2xl border border-fd-border bg-fd-card">
      <div
        className="flex items-center gap-2 border-b border-fd-border px-4 py-2.5 sm:px-6"
        style={{
          background:
            'linear-gradient(90deg, oklch(0.72 0.15 85 / 0.14), oklch(0.65 0.17 45 / 0.10))',
        }}
      >
        <span
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ background: COLORS.classA }}
        />
        <p className="text-xs leading-relaxed text-fd-foreground/80">
          ZBSearch Edge is unoptimized right now. Real-world costs are higher than they should be, and we&apos;re actively
          working to make it <strong className="font-semibold">way cheaper</strong>.
        </p>
      </div>

      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="flex flex-col gap-5 rounded-xl bg-fd-muted/20 p-4">
          <Slider
            label="Documents"
            value={docs}
            min={1_000}
            max={10_000_000}
            format={formatCompact}
            onChange={(value) => {
              setDocs(value);
              setShards(suggestedShards(value));
            }}
          />
          <Slider
            label="Searches"
            hint="/ month"
            value={searches}
            min={10_000}
            max={1_000_000_000}
            format={formatCompact}
            onChange={setSearches}
          />
          <Slider
            label="Document writes"
            hint="/ month"
            value={writes}
            min={1_000}
            max={100_000_000}
            format={formatCompact}
            onChange={setWrites}
          />
          <Slider
            label="Shards"
            hint="auto-suggested"
            value={shards}
            min={1}
            max={32}
            log={false}
            format={(value) => `${value}`}
            onChange={setShards}
          />
          <Slider
            label="Cold-isolate searches"
            value={coldPct}
            min={0}
            max={20}
            log={false}
            format={(value) => `${value}%`}
            onChange={setColdPct}
          />
          <label className="flex items-start gap-2.5 rounded-lg border border-fd-border bg-fd-card px-3 py-2.5 text-xs text-fd-muted-foreground">
            <input
              type="checkbox"
              checked={metaCache}
              onChange={(event) => setMetaCache(event.target.checked)}
              className="mt-0.5 accent-fd-primary"
            />
            <span>
              <span className="font-medium text-fd-foreground">In-isolate index-meta cache</span>
              <span className="mt-0.5 block text-fd-muted-foreground/80">
                Caches per-shard <code>meta.json</code> reads instead of hitting R2 on every
                search. Biggest single cost lever at high QPS.
              </span>
            </span>
          </label>
        </div>

        <div className="flex flex-col">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-fd-muted-foreground">
                Estimated monthly cost
              </div>
              <div
                className="text-3xl font-bold tabular-nums tracking-tight"
                style={{ color: COLORS.total }}
              >
                {formatUsd(result.total)}
                <span className="ml-1 text-sm font-normal text-fd-muted-foreground">/mo</span>
              </div>
            </div>
            <div
              className="rounded-full px-3 py-1 text-xs font-semibold tabular-nums"
              style={{ background: 'oklch(0.62 0.17 155 / 0.12)', color: COLORS.total }}
            >
              {formatUsd(result.perMillionSearches)} per 1M searches
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3">
            {result.breakdown.map((row) => (
              <div key={row.label}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 text-fd-muted-foreground">
                    <span
                      className="inline-block size-2 shrink-0 rounded-full"
                      style={{ background: row.color }}
                    />
                    {row.label}
                  </span>
                  <span className="tabular-nums">
                    <span className="font-semibold text-fd-foreground">
                      {formatUsd(row.cost)}
                    </span>
                    <span className="ml-2 text-fd-muted-foreground/70">{row.usage}</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-fd-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      background: row.color,
                      width: `${maxRowCost > 0 ? Math.max(1.5, (row.cost / maxRowCost) * 100) : 1.5}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-col gap-1.5 text-xs leading-relaxed text-fd-muted-foreground">
            {result.fitsFreePlan ? (
              <p
                className="rounded-lg px-3 py-2"
                style={{ background: 'oklch(0.65 0.15 250 / 0.10)' }}
              >
                Fits the Workers Free plan for requests, but note the free plan caps CPU at
                10ms per invocation - searches on larger corpora will fail there.
              </p>
            ) : (
              <p
                className="rounded-lg px-3 py-2"
                style={{ background: 'oklch(0.65 0.15 250 / 0.10)' }}
              >
                Requires Workers Paid ($5/mo base, included above). The free plan caps CPU at
                10ms per invocation, which search workloads exceed.
              </p>
            )}
            {result.exceedsCpuLimit ? (
              <p
                className="rounded-lg px-3 py-2"
                style={{ background: 'oklch(0.72 0.15 85 / 0.12)' }}
              >
                Warning: cold-start CPU ({formatCompact(result.warmCpuMs + result.coldExtraCpuMs)}
                ms) exceeds the 300s <code>cpu_ms</code> limit - use more, smaller shards.
              </p>
            ) : null}
            <p className="px-1">
              Warm search ~{result.warmCpuMs.toFixed(1)}ms CPU; cold isolate adds ~
              {formatCompact(result.coldExtraCpuMs)}ms for snapshot load.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
