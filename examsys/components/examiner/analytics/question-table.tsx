"use client";

import { useMemo, useState } from "react";
import type { DifficultyName, QuestionAnalyticsItem } from "@/lib/validation/analytics";

type SortKey = "order" | "correctPct" | "skippedPct" | "avgMarksPct" | "discrimination" | "difficulty";
type Sort = { key: SortKey; direction: "asc" | "desc" };

const DIFFICULTY_RANK: Record<DifficultyName, number> = { EASY: 0, MEDIUM: 1, HARD: 2 };
const difficultyLabel = (value: DifficultyName) => value.charAt(0) + value.slice(1).toLowerCase();

/** Numbers to sort by; `null` (unknown) always sorts last. */
function sortValue(item: QuestionAnalyticsItem, index: number, key: SortKey): number | null {
  switch (key) {
    case "order":
      return index;
    case "difficulty":
      return item.observedDifficulty ? DIFFICULTY_RANK[item.observedDifficulty] : null;
    default:
      return item[key];
  }
}

const badge = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap";
const tones = {
  red: "bg-red-50 text-red-800 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900",
  amber: "bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900",
  green: "bg-green-50 text-green-800 ring-green-200 dark:bg-green-950 dark:text-green-200 dark:ring-green-900",
  gray: "bg-gray-50 text-gray-700 ring-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-700",
};

function CorrectBar({ value }: Readonly<{ value: number | null }>) {
  if (value === null) return <span className="opacity-60" title="Written answers are still being graded">Pending</span>;
  const tone = value < 20 ? "bg-red-500" : value < 40 ? "bg-amber-500" : "bg-green-600 dark:bg-green-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-black/10 dark:bg-white/15" aria-hidden>
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <span className="tabular-nums">{value}%</span>
    </div>
  );
}

function Skipped({ value }: Readonly<{ value: number }>) {
  if (value > 30) return <span className={`${badge} ${tones.red}`}>{value}% <span className="sr-only">(high)</span></span>;
  return <span className="tabular-nums">{value}%</span>;
}

function Discrimination({ value }: Readonly<{ value: number | null }>) {
  if (value === null) return <span className="opacity-60" title="Needs at least 4 graded answers">n/a</span>;
  const [label, tone] = value < 0 ? ["Negative", tones.red] : value < 0.2 ? ["Weak", tones.amber] : ["Good", tones.green];
  return (
    <span className={`${badge} ${tone} gap-1`}>
      <span className="tabular-nums">{value.toFixed(2)}</span> {label}
    </span>
  );
}

function Difficulty({ item }: Readonly<{ item: QuestionAnalyticsItem }>) {
  const mismatch = item.observedDifficulty !== null && item.observedDifficulty !== item.declaredDifficulty;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span title="Declared">{difficultyLabel(item.declaredDifficulty)}</span>
      <span aria-hidden className="opacity-50">→</span>
      <span className="sr-only">observed</span>
      <span title="Observed" className="font-medium">
        {item.observedDifficulty ? difficultyLabel(item.observedDifficulty) : "—"}
      </span>
      {mismatch && <span className={`${badge} ${tones.amber}`}>Mismatch</span>}
    </div>
  );
}

const COLUMNS: { key: SortKey; label: string; hint?: string }[] = [
  { key: "order", label: "#" },
  { key: "correctPct", label: "Correct", hint: "Objective: full marks. Written: at least 50% of the marks." },
  { key: "skippedPct", label: "Skipped" },
  { key: "avgMarksPct", label: "Avg marks" },
  { key: "discrimination", label: "Discrimination", hint: "Correct rate of the top 27% minus the bottom 27% (by total score)." },
  { key: "difficulty", label: "Difficulty", hint: "Declared → observed (≥70% correct easy, <40% hard)." },
];

/** Per-question statistics, sortable by every numeric column (click a header). */
export function QuestionTable({ items }: Readonly<{ items: QuestionAnalyticsItem[] }>) {
  const [sort, setSort] = useState<Sort>({ key: "order", direction: "asc" });

  const rows = useMemo(() => {
    const indexed = items.map((item, index) => ({ item, index, value: sortValue(item, index, sort.key) }));
    const factor = sort.direction === "asc" ? 1 : -1;
    return indexed.sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      return (a.value - b.value) * factor || a.index - b.index;
    });
  }, [items, sort]);

  function toggle(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "order" ? "asc" : "desc" },
    );
  }

  const header = (column: (typeof COLUMNS)[number]) => {
    const active = sort.key === column.key;
    return (
      <th
        key={column.key}
        scope="col"
        className="px-3 py-3"
        aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      >
        <button
          type="button"
          onClick={() => toggle(column.key)}
          title={column.hint}
          className="inline-flex items-center gap-1 uppercase tracking-wide hover:underline focus-visible:underline"
        >
          {column.label}
          <span aria-hidden className={active ? "" : "opacity-30"}>
            {active && sort.direction === "desc" ? "▼" : "▲"}
          </span>
        </button>
      </th>
    );
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/15">
      <table className="w-full min-w-240 text-left text-sm">
        <caption className="sr-only">Question analytics. Column headers are buttons that sort the table.</caption>
        <thead className="bg-black/3 text-xs opacity-90 dark:bg-white/5">
          <tr>
            {header(COLUMNS[0])}
            <th scope="col" className="px-3 py-3 uppercase tracking-wide">Question</th>
            {COLUMNS.slice(1).map(header)}
            <th scope="col" className="px-3 py-3 uppercase tracking-wide">Most chosen wrong option</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ item, index }) => (
            <tr key={item.questionId} className="border-t border-black/5 align-top dark:border-white/10">
              <td className="px-3 py-3 tabular-nums opacity-70">{index + 1}</td>
              <td className="max-w-80 px-3 py-3">
                <p className="line-clamp-2 font-medium" title={item.text}>{item.text}</p>
                <p className="mt-1 text-xs opacity-60">
                  {item.type} · {item.topic || "No topic"} · {item.marks} mark{item.marks === 1 ? "" : "s"} · {item.attempts} attempt{item.attempts === 1 ? "" : "s"}
                  {item.pendingGrading > 0 && ` · ${item.pendingGrading} awaiting grading`}
                </p>
                {item.flags.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-1">
                    {item.flags.map((flag) => (
                      <span key={flag} className={`${badge} ${tones.red}`}>
                        {flag === "LOW_CORRECT" ? "Low correct" : "High skipped"}
                      </span>
                    ))}
                  </p>
                )}
              </td>
              <td className="px-3 py-3"><CorrectBar value={item.correctPct} /></td>
              <td className="px-3 py-3"><Skipped value={item.skippedPct} /></td>
              <td className="px-3 py-3 tabular-nums">{item.avgMarksPct === null ? "—" : `${item.avgMarksPct}%`}</td>
              <td className="px-3 py-3"><Discrimination value={item.discrimination} /></td>
              <td className="px-3 py-3"><Difficulty item={item} /></td>
              <td className="max-w-56 px-3 py-3">
                {item.mostChosenWrongOption ? (
                  <span>
                    <span className="line-clamp-2" title={item.mostChosenWrongOption.text}>{item.mostChosenWrongOption.text}</span>
                    <span className="text-xs opacity-60">
                      chosen {item.mostChosenWrongOption.count} time{item.mostChosenWrongOption.count === 1 ? "" : "s"}
                    </span>
                  </span>
                ) : (
                  <span className="opacity-60">{item.type === "WRITTEN" ? "n/a (written)" : "—"}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
