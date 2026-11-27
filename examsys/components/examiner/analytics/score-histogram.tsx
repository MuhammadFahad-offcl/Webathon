"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { DistributionBucket } from "@/lib/validation/analytics";

type Row = { label: string; range: string; count: number; share: number };

const plural = (count: number) => `${count} attempt${count === 1 ? "" : "s"}`;

function rangeLabel(bucket: DistributionBucket, last: boolean) {
  return last ? `${bucket.from}–${bucket.to}%` : `${bucket.from}–<${bucket.to}%`;
}

function HistogramTooltip({ active, payload }: TooltipContentProps) {
  const row = payload?.[0]?.payload as Row | undefined;
  if (!active || !row) return null;
  return (
    <div className="rounded-md border border-black/10 bg-white px-3 py-2 text-sm shadow-md dark:border-white/15 dark:bg-neutral-900">
      <p className="font-medium">Score {row.range}</p>
      <p className="tabular-nums opacity-80">
        {plural(row.count)} ({row.share}%)
      </p>
    </div>
  );
}

/**
 * Score distribution: ten 10-point percentage buckets. Colors come from CSS variables so the
 * bar, grid and axis text are each tuned for light and dark mode; a table view sits below.
 */
export function ScoreHistogram({ distribution, passPercent }: Readonly<{ distribution: DistributionBucket[]; passPercent: number }>) {
  const total = distribution.reduce((sum, bucket) => sum + bucket.count, 0);
  const rows: Row[] = distribution.map((bucket, index) => ({
    label: `${bucket.from}–${bucket.to}`,
    range: rangeLabel(bucket, index === distribution.length - 1),
    count: bucket.count,
    share: total ? Math.round((bucket.count / total) * 1000) / 10 : 0,
  }));
  const summary = rows
    .filter((row) => row.count > 0)
    .map((row) => `${row.range}: ${plural(row.count)}`)
    .join("; ");

  return (
    <figure className="flex flex-col gap-3 [--bar:#257de0] [--grid:rgb(0_0_0/0.08)] dark:[--bar:#338ced] dark:[--grid:rgb(255_255_255/0.12)]">
      <div
        className="h-64 w-full text-xs text-neutral-600 dark:text-neutral-400"
        role="img"
        aria-label={`Histogram of score percentages for ${plural(total)}. ${summary || "No attempts."}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: 0 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="label"
              tick={{ fill: "currentColor" }}
              tickLine={false}
              axisLine={{ stroke: "var(--grid)" }}
              label={{ value: "Score (%)", position: "insideBottom", offset: -4, fill: "currentColor" }}
              height={40}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: "currentColor" }}
              tickLine={false}
              axisLine={false}
              width={36}
              label={{ value: "Attempts", angle: -90, position: "insideLeft", offset: 12, fill: "currentColor" }}
            />
            <Tooltip content={HistogramTooltip} cursor={{ fill: "var(--grid)" }} />
            <Bar dataKey="count" name="Attempts" fill="var(--bar)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="text-xs opacity-70">
        Each bar covers 10 percentage points (lower bound included; the last bar also includes 100%). Pass mark:{" "}
        {passPercent}%.
      </figcaption>
      <details className="text-sm">
        <summary className="cursor-pointer select-none opacity-80 hover:opacity-100">Show as table</summary>
        <table className="mt-2 w-full max-w-sm text-left">
          <caption className="sr-only">Score distribution</caption>
          <thead className="text-xs uppercase tracking-wide opacity-70">
            <tr>
              <th scope="col" className="py-1 pr-4">Score</th>
              <th scope="col" className="py-1 pr-4 text-right">Attempts</th>
              <th scope="col" className="py-1 text-right">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-black/5 dark:border-white/10">
                <td className="py-1 pr-4">{row.range}</td>
                <td className="py-1 pr-4 text-right tabular-nums">{row.count}</td>
                <td className="py-1 text-right tabular-nums">{row.share}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
