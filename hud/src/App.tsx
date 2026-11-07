import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { suggestionFromFixture, type Suggestion } from "./suggestion";
import "./App.css";

type TabCard = {
  id: number;
  title: string;
  subtitle: string;
  accent: string;
  active?: boolean;
};

const sampleTabs: TabCard[] = [
  { id: 1, title: "VS Code", subtitle: "workbench / code", accent: "#7dd3fc", active: true },
  { id: 2, title: "Terminal", subtitle: "platformer / build", accent: "#86efac" },
  { id: 3, title: "Browser", subtitle: "github / tabs", accent: "#f9a8d4" },
  { id: 4, title: "Discord", subtitle: "team chat", accent: "#c4b5fd" },
  { id: 5, title: "Spotify", subtitle: "focus mix", accent: "#fca5a5" },
  { id: 6, title: "Notion", subtitle: "planning", accent: "#fcd34d" },
import "./App.css";

type ActionCard = {
  kind: string;
  title: string;
  detail: string;
};

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

const DEFAULT_ACTIONS: ActionCard[] = [
  { kind: "open_godot", title: "Godot", detail: "Project path from aura.config.json" },
  { kind: "open_terminal", title: "Terminal", detail: "Repo path from aura.config.json" },
  { kind: "focus_discord", title: "Discord", detail: "Discord" },
];

function runningInTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function suggestionFromNote(note: string, current: Suggestion | null): Suggestion | null {
  const url = note.match(/(?:https?:\/\/|www\.)[^\s<>"']+/i)?.[0]?.replace(/[.,;:!?)\]]+$/, "");
  if (url) {
    const target = url.toLowerCase().startsWith("www.") ? `https://${url}` : url;
    return {
      kind: "open_url",
      title: "Open this website",
      detail: target,
      reason: "A website link appears in your note.",
      source: "note",
    };
  }

  if (/\b(discord)\b/i.test(note)) {
    return {
      kind: "open_url",
      title: "Open Discord",
      detail: "discord://",
      reason: "Your note mentions Discord.",
      source: "note",
    };
  }

  if (/\b(godot|platformer)\b/i.test(note) && current?.kind === "open_godot") {
    return current;
  }

  return null;
}

export default function App() {
  const [actions, setActions] = useState<ActionCard[]>(DEFAULT_ACTIONS);
  const [suggestedKind, setSuggestedKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteLoaded, setNoteLoaded] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [saveState, setSaveState] = useState("Saved");
  const [actionError, setActionError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!runningInTauri()) {
      setNote(window.localStorage.getItem("aura.quick-note") ?? "");
      setNoteLoaded(true);
      return;
    }

    invoke<string>("read_scratchpad")
      .then(setNote)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setNoteLoaded(true));
  }, []);

  useEffect(() => {
    if (!noteLoaded) return;
    window.localStorage.setItem("aura.quick-note", note);
    if (!runningInTauri()) return;

    setSaveState("Saving");
    const timer = window.setTimeout(() => {
      invoke("write_scratchpad", { text: note })
        .then(() => setSaveState("Saved"))
        .catch((reason: unknown) => {
          setSaveState("Not saved");
          setError(reason instanceof Error ? reason.message : String(reason));
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [note, noteLoaded]);

  useEffect(() => {
    if (noteOpen) noteRef.current?.focus();
  }, [noteOpen]);

  useEffect(() => {
    if (!runningInTauri()) {
      return;
    }

    let unlistenSnapshot: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    listen<SnapshotPayload>("snapshot", (event) => {
      const payload = event.payload;
      if (payload.actions && payload.actions.length > 0) {
        setActions(payload.actions);
      }
      setSuggestedKind(payload.suggestion?.kind ?? null);
    }).then((stop) => {
      unlistenSnapshot = stop;
    });

    listen<string>("hud-error", (event) => {
      setError(event.payload);
    }).then((stop) => {
      unlistenError = stop;
    });

    return () => {
      unlistenSnapshot?.();
      unlistenError?.();
    };
  }, []);

  const noteSuggestion = suggestionFromNote(note, suggestion);
  const visibleSuggestion = noteSuggestion ?? suggestion;
  const title = visibleSuggestion?.title ?? (error ? "Could not read the suggestion" : "No suggested action");

  async function openSuggestion() {
    if (!visibleSuggestion?.detail) return;
    setActionError(null);
    try {
      if (/^(https?:\/\/|www\.)/i.test(visibleSuggestion.detail)) {
        const target = visibleSuggestion.detail.startsWith("www.")
          ? `https://${visibleSuggestion.detail}`
          : visibleSuggestion.detail;
        if (runningInTauri()) await openUrl(target);
        else window.open(target, "_blank", "noopener,noreferrer");
      } else if (runningInTauri()) {
        if (visibleSuggestion.detail.includes("://")) await openUrl(visibleSuggestion.detail);
        else await openPath(visibleSuggestion.detail);
      } else {
        setActionError("Opening applications is available in the Windows app.");
      }
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function startQuickNote() {
    setNote((current) => current ? `${current}${current.endsWith("\n") ? "" : "\n"}\n- ` : "- ");
    setNoteOpen(true);
  }

  return (
    <main className="hud">
      <div className="hud__ambient" />

      <header className="hud__header">
        <div className="hud__brand">
          <span className="hud__badge">Aura</span>
          <span className="hud__status">{visibleSuggestion?.source ?? "live"}</span>
        </div>
        <span className="hud__meta">Alt-tab</span>
      </header>

      <section className="hud__content">
        <div className="hud__focus-panel">
          <p className="hud__label">Focused task</p>
          <h1>{title}</h1>
          {visibleSuggestion?.detail && <p className="detail">{visibleSuggestion.detail}</p>}
          {visibleSuggestion?.reason && <p className="reason">{visibleSuggestion.reason}</p>}
          {visibleSuggestion?.detail && (
            <button type="button" className="suggestion-action" onClick={openSuggestion}>
              Open
            </button>
          )}
          {actionError && <p className="reason">{actionError}</p>}
          {error && <p className="reason">{error}</p>}
        </div>
      </section>

      {noteOpen && (
        <section className="quick-note" aria-label="Quick note">
          <div className="quick-note__heading">
            <strong>Quick note</strong>
            <span>{saveState}</span>
            <button type="button" aria-label="Close note" onClick={() => setNoteOpen(false)}>×</button>
          </div>
          <textarea
            ref={noteRef}
            aria-label="Note text"
            placeholder="Write a todo, paste a link, or mention an app..."
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </section>
      )}

      <div className="hud__tabs" role="list" aria-label="Open windows">
        <button type="button" className="quick-note-trigger" onClick={startQuickNote}>
          <span aria-hidden="true">+</span> Quick note
        </button>
        <div className="tab-card-list">
        {sampleTabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            className={`tab-card ${tab.active ? "is-active" : ""}`}
            style={{
              ["--accent" as string]: tab.accent,
              ["--index" as string]: String(index),
            }}
          >
            <div className="tab-card__visual">
              <span className="tab-card__dot" />
            </div>
            <div className="tab-card__body">
              <strong>{tab.title}</strong>
              <small>{tab.subtitle}</small>
            </div>
          </button>
        ))}
        </div>
      </div>
  async function openAction(kind: string) {
    setError(null);
    if (!runningInTauri()) {
      setError("Open works from the Aura window, with the watcher running.");
      return;
    }
    try {
      await invoke("open_action", { kind });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <main className="dashboard">
      <header className="heading">
        <p className="kicker">Aura</p>
        <h1>Where next</h1>
      </header>
      <section className="cards">
        {actions.map((action) => {
          const suggested = action.kind === suggestedKind;
          return (
            <article key={action.kind} className={suggested ? "card suggested" : "card"}>
              <p className="kicker">{suggested ? "Suggested" : "Open"}</p>
              <h2>{action.title}</h2>
              <p className="detail">{action.detail}</p>
              <button type="button" onClick={() => openAction(action.kind)}>
                Open
              </button>
            </article>
          );
        })}
      </section>
      {error && <p className="error">{error}</p>}
      <p className="hint">Ctrl+Alt+Space hides Aura</p>
    </main>
  );
}
