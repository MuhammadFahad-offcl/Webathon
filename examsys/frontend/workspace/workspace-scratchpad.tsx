"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/frontend/components/ui/button";
import { Dialog } from "@/frontend/components/ui/dialog";
import {
  deleteScratchpadItem,
  getScratchpadItem,
  putScratchpadItem,
} from "@/lib/offline/outbox";

type Props = {
  attemptId: string;
  open: boolean;
  onToggle: () => void;
};

export function WorkspaceScratchpad({ attemptId, open, onToggle }: Readonly<Props>) {
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [saveState, setSaveState] = useState<"loading" | "saved" | "saving" | "failed">("loading");
  const [error, setError] = useState<string | null>(null);
  const wasOpenRef = useRef(open);

  const persistText = useCallback(async (value: string) => {
    try {
      if (value.length === 0) {
        await deleteScratchpadItem(attemptId);
      } else {
        await putScratchpadItem({ attemptId, text: value, updatedAt: Date.now() });
      }
      setSaveState("saved");
      setError(null);
    } catch (saveError) {
      setSaveState("failed");
      setError(saveError instanceof Error ? saveError.message : "The scratchpad could not be saved.");
    }
  }, [attemptId]);

  useEffect(() => {
    let active = true;
    getScratchpadItem(attemptId).then((item) => {
      if (!active) return;
      setText(item?.text ?? "");
      setSaveState("saved");
      setLoaded(true);
    }).catch((loadError: unknown) => {
      if (!active) return;
      setError(loadError instanceof Error ? loadError.message : "The scratchpad could not be loaded.");
      setSaveState("failed");
    });
    return () => {
      active = false;
    };
  }, [attemptId]);

  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => void persistText(text), 750);
    return () => window.clearTimeout(timer);
  }, [loaded, persistText, text]);

  useEffect(() => {
    if (!loaded) return;
    const saveBeforeLeaving = () => void persistText(text);
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") saveBeforeLeaving();
    };
    window.addEventListener("pagehide", saveBeforeLeaving);
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      window.removeEventListener("pagehide", saveBeforeLeaving);
      document.removeEventListener("visibilitychange", saveWhenHidden);
    };
  }, [loaded, persistText, text]);

  useEffect(() => {
    if (wasOpenRef.current && !open) void persistText(text);
    wasOpenRef.current = open;
  }, [open, persistText, text]);

  function closeScratchpad() {
    onToggle();
  }

  function clearScratchpad() {
    setText("");
    setClearOpen(false);
    void persistText("");
  }

  const saveLabel = {
    loading: "Loading local notes…",
    saved: "Saved on this device only",
    saving: "Saving locally…",
    failed: "Local save failed",
  }[saveState];

  return (
    <>
      <section className="workspace-scratchpad page-surface" aria-labelledby={`scratchpad-title-${attemptId}`}>
        <header className="flex items-center justify-between gap-3">
          <h2 className="font-bold" id={`scratchpad-title-${attemptId}`}>Scratchpad</h2>
          <Button
            variant="secondary"
            type="button"
            aria-expanded={open}
            onClick={open ? closeScratchpad : onToggle}
          >
            {open ? "Close" : "Open"}
          </Button>
        </header>
        {open && (
          <div className="mt-4 grid gap-3">
            <p className="text-xs text-muted">Private rough work. These notes stay on this device and are never sent to the examiner.</p>
            <label className="form-label" htmlFor={`scratchpad-text-${attemptId}`}>Your notes</label>
            <textarea
              id={`scratchpad-text-${attemptId}`}
              className="field-control min-h-48 resize-y"
              maxLength={20_000}
              value={text}
              disabled={!loaded}
              onChange={(event) => {
                setText(event.target.value);
                setSaveState("saving");
              }}
              aria-describedby={`scratchpad-status-${attemptId}`}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted" id={`scratchpad-status-${attemptId}`} role="status" aria-live="polite">
                {saveLabel}
              </span>
              <Button variant="secondary" type="button" onClick={() => setClearOpen(true)} disabled={!text || !loaded}>
                Clear notes
              </Button>
            </div>
            {error && <p className="text-sm text-[var(--danger)]" role="alert">{error}</p>}
          </div>
        )}
      </section>

      <Dialog open={clearOpen} title="Clear scratchpad?" onClose={() => setClearOpen(false)}>
        <div className="grid gap-4">
          <p className="text-sm text-muted">This permanently clears the notes saved for this attempt on this device.</p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" type="button" onClick={() => setClearOpen(false)}>Keep notes</Button>
            <Button type="button" onClick={clearScratchpad}>Clear notes</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
