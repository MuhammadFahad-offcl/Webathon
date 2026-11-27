"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type TabItem = {
  id: string;
  label: string;
  content: ReactNode;
};

type Props = {
  items: TabItem[];
  label: string;
};

export function Tabs({ items, label }: Readonly<Props>) {
  const [selected, setSelected] = useState(items[0]?.id ?? "");
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const idPrefix = useId();

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % items.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + items.length) % items.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const item = items[nextIndex];
    if (!item) return;
    setSelected(item.id);
    buttonRefs.current[nextIndex]?.focus();
  }

  const active = items.find((item) => item.id === selected) ?? items[0];
  if (!active) return null;

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)]" role="tablist" aria-label={label}>
        {items.map((item, index) => {
          const isSelected = item.id === active.id;
          return (
            <button
              key={item.id}
              ref={(node) => { buttonRefs.current[index] = node; }}
              type="button"
              role="tab"
              className="shrink-0 border-b-2 border-transparent px-4 py-3 text-sm font-bold text-muted aria-selected:border-[var(--brand)] aria-selected:text-[var(--text)]"
              id={`${idPrefix}-tab-${item.id}`}
              aria-selected={isSelected}
              aria-controls={`${idPrefix}-panel-${item.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setSelected(item.id)}
              onKeyDown={(event) => moveFocus(event, index)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <section
        className="pt-4"
        role="tabpanel"
        id={`${idPrefix}-panel-${active.id}`}
        aria-labelledby={`${idPrefix}-tab-${active.id}`}
        tabIndex={0}
      >
        {active.content}
      </section>
    </div>
  );
}
