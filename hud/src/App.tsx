import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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

export default function App() {
  const [actions, setActions] = useState<ActionCard[]>(DEFAULT_ACTIONS);
  const [suggestedKind, setSuggestedKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteLoaded, setNoteLoaded] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [saveState, setSaveState] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!runningInTauri()) {
      setNoteLoaded(true);
      return;
    }

    invoke<string>("read_scratchpad")
      .then(setNote)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setNoteLoaded(true));
  }, []);

  useEffect(() => {
    if (!noteLoaded || !runningInTauri()) return;

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
      <div className="note-bar">
        <button type="button" className="quick-note-trigger" onClick={() => setNoteOpen((open) => !open)}>
          Quick note
        </button>
        <p className="hint">Ctrl+Alt+Space hides Aura</p>
      </div>
      {noteOpen && (
        <section className="quick-note" aria-label="Quick note">
          <div className="quick-note__heading">
            <strong>Quick note</strong>
            {saveState ? <span>{saveState}</span> : <span />}
            <button type="button" aria-label="Close note" onClick={() => setNoteOpen(false)}>
              ×
            </button>
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
    </main>
  );
}
