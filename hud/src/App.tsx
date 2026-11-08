import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import DashboardStage from "./components/DashboardStage";
import type { ActionCard, SuggestionError } from "./components/Suggestions";
import { useDashboardLayout } from "./layout/useDashboardLayout";
import { runningInTauri } from "./tauri";
import "./App.css";

type Suggestion = {
  kind: string;
  title: string;
  detail: string;
  reason: string;
  source: string;
};

type SnapshotPayload = {
  suggestion?: Suggestion | null;
  actions?: ActionCard[];
};

type HudErrorPayload = {
  message?: string;
  kind?: string | null;
};

function messageFrom(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function hudErrorFromPayload(payload: HudErrorPayload | string): SuggestionError {
  if (typeof payload === "string") {
    return { message: payload || "Open failed", kind: null };
  }
  const message =
    typeof payload.message === "string" && payload.message.trim().length > 0 ? payload.message : "Open failed";
  const kind = typeof payload.kind === "string" && payload.kind.length > 0 ? payload.kind : null;
  return { message, kind };
}

type HudVisibility = {
  visible: boolean;
};

type HudClosing = {
  generation: number;
};

type MotionPose = "open" | "closed";

/** Matches the CSS composition. The hide waits a little longer so the transition can finish. */
const FINISH_AFTER_MS = 360;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setHudVisible(visible: boolean) {
  const value = visible ? "true" : "false";
  document.documentElement.dataset.hudVisible = value;
  const root = document.getElementById("root");
  if (!root) return;
  root.dataset.hudVisible = value;
  root.classList.toggle("hud-visible", visible);
  root.classList.toggle("hud-hidden", !visible);
}

export default function App() {
  const dashboard = useDashboardLayout();
  const [actions, setActions] = useState<ActionCard[]>([]);
  const [suggestedKind, setSuggestedKind] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<SuggestionError | null>(null);
  const actionsRef = useRef<ActionCard[]>([]);
  const holdRef = useRef(false);
  const pendingSnapshotRef = useRef<SnapshotPayload | null>(null);
  const applySnapshotRef = useRef<(payload: SnapshotPayload) => void>(() => {});
  const [note, setNote] = useState("");
  const [noteLoaded, setNoteLoaded] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const saveGeneration = useRef(0);
  const animations = dashboard.layout?.animations ?? true;
  const [reduceMotion, setReduceMotion] = useState(prefersReducedMotion);
  const motionOn = animations && !reduceMotion;
  const motionOnRef = useRef(motionOn);
  motionOnRef.current = motionOn;
  const [pose, setPose] = useState<MotionPose>(runningInTauri() ? "closed" : "open");
  const closingGeneration = useRef<number | null>(null);
  const exitTimer = useRef(0);
  const openTicket = useRef(0);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduceMotion(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (motionOn || closingGeneration.current === null) return;
    const generation = closingGeneration.current;
    closingGeneration.current = null;
    window.clearTimeout(exitTimer.current);
    exitTimer.current = 0;
    openTicket.current += 1;
    if (!runningInTauri()) return;
    void invoke("finish_dismiss", { generation });
  }, [motionOn]);

  useEffect(() => {
    if (!runningInTauri()) {
      setNoteLoaded(true);
      return;
    }

    let active = true;
    invoke<string>("read_scratchpad")
      .then((text) => {
        if (!active) return;
        setNote(text);
        setNoteLoaded(true);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setNoteError(messageFrom(reason));
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!noteLoaded || !runningInTauri()) return;

    const generation = ++saveGeneration.current;
    const text = note;
    const timer = window.setTimeout(() => {
      invoke("write_scratchpad", { text })
        .then(() => {
          if (saveGeneration.current === generation) setNoteError(null);
        })
        .catch((reason: unknown) => {
          if (saveGeneration.current === generation) setNoteError(messageFrom(reason));
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [note, noteLoaded]);

  useEffect(() => {
    if (noteOpen) noteRef.current?.focus();
  }, [noteOpen]);

  useEffect(() => {
    if (!runningInTauri()) {
      setHudVisible(true);
      return;
    }

    setHudVisible(document.visibilityState !== "hidden");
    let active = true;
    let unlistenVisibility: (() => void) | undefined;
    let unlistenClosing: (() => void) | undefined;

    const clearExit = () => {
      window.clearTimeout(exitTimer.current);
      exitTimer.current = 0;
      closingGeneration.current = null;
    };

    listen<HudVisibility>("hud-visibility", (event) => {
      if (!active) return;
      const visible = event.payload.visible;
      setHudVisible(visible);
      if (!visible) {
        clearExit();
        openTicket.current += 1;
        setPose("closed");
        return;
      }
      const reversing = closingGeneration.current !== null;
      clearExit();
      if (!motionOnRef.current || reversing) {
        openTicket.current += 1;
        setPose("open");
        return;
      }
      setPose("closed");
      const ticket = ++openTicket.current;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!active || openTicket.current !== ticket) return;
          if (closingGeneration.current !== null) return;
          setPose("open");
        });
      });
    }).then((stop) => {
      if (active) unlistenVisibility = stop;
      else stop();
    });

    listen<HudClosing>("hud-closing", (event) => {
      if (!active) return;
      const generation = event.payload.generation;
      openTicket.current += 1;
      if (!motionOnRef.current) {
        clearExit();
        void invoke("finish_dismiss", { generation });
        return;
      }
      closingGeneration.current = generation;
      setPose("closed");
      window.clearTimeout(exitTimer.current);
      exitTimer.current = window.setTimeout(() => {
        if (!active || closingGeneration.current !== generation) return;
        closingGeneration.current = null;
        exitTimer.current = 0;
        void invoke("finish_dismiss", { generation });
      }, FINISH_AFTER_MS);
    }).then((stop) => {
      if (active) unlistenClosing = stop;
      else stop();
    });

    return () => {
      active = false;
      window.clearTimeout(exitTimer.current);
      unlistenVisibility?.();
      unlistenClosing?.();
    };
  }, []);

  useEffect(() => {
    if (!runningInTauri()) {
      return;
    }

    let unlistenSnapshot: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    listen<SnapshotPayload>("snapshot", (event) => {
      const payload = event.payload ?? {};
      if (holdRef.current) {
        pendingSnapshotRef.current = payload;
        return;
      }
      applySnapshotRef.current(payload);
    }).then((stop) => {
      unlistenSnapshot = stop;
    });

    listen<HudErrorPayload | string>("hud-error", (event) => {
      setError(hudErrorFromPayload(event.payload));
    }).then((stop) => {
      unlistenError = stop;
    });

    return () => {
      unlistenSnapshot?.();
      unlistenError?.();
    };
  }, []);

  applySnapshotRef.current = (payload) => {
    const hasActions = Array.isArray(payload.actions);
    const nextActions = hasActions ? payload.actions ?? [] : actionsRef.current;
    const previousActions = actionsRef.current;
    if (hasActions) {
      actionsRef.current = nextActions;
      setActions(nextActions);
    }
    setSuggestedKind(payload.suggestion?.kind ?? null);
    setReason(payload.suggestion?.reason ?? null);
    if (!hasActions) return;
    setError((current) => {
      if (!current?.kind) return current;
      const prior = previousActions.find((card) => card.kind === current.kind);
      const next = nextActions.find((card) => card.kind === current.kind);
      if (!next || !prior) return null;
      if (prior.title !== next.title || prior.detail !== next.detail) return null;
      return current;
    });
  };

  function onSuggestionHold(held: boolean) {
    holdRef.current = held;
    if (held || pendingSnapshotRef.current === null) return;
    const pending = pendingSnapshotRef.current;
    pendingSnapshotRef.current = null;
    applySnapshotRef.current(pending);
  }

  async function openAction(kind: string) {
    setError((current) => (current === null || current.kind === null || current.kind === kind ? null : current));
    if (!runningInTauri()) {
      setError({ message: "Open works from the Aura window, with the watcher running.", kind });
      return;
    }
    try {
      await invoke("open_action", { kind });
    } catch (reason: unknown) {
      setError({ message: messageFrom(reason), kind });
    }
  }

  return (
    <main
      ref={dashboard.stageRef}
      className="dashboard"
      data-editing={dashboard.editMode ? "true" : "false"}
      data-animations={motionOn ? "true" : "false"}
      data-motion={pose}
    >
      <div className="stage-veil" aria-hidden="true" />
      <DashboardStage
        dashboard={dashboard}
        actions={actions}
        suggestedKind={suggestedKind}
        reason={reason}
        error={error}
        onOpen={openAction}
        onHoldChange={onSuggestionHold}
        note={note}
        onNoteChange={setNote}
        noteOpen={noteOpen}
        onNoteOpenChange={setNoteOpen}
        noteError={noteError}
        noteRef={noteRef}
      />
    </main>
  );
}
