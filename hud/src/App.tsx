import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
];

function runningInTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export default function App() {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runningInTauri()) {
      setSuggestion(suggestionFromFixture());
      return;
    }

    let live = false;
    let unlisten: (() => void) | undefined;
    listen<Suggestion>("suggestion", (event) => {
      live = true;
      setError(null);
      setSuggestion(event.payload);
    }).then((stop) => {
      unlisten = stop;
    });

    invoke<Suggestion>("read_suggestion")
      .then((value) => {
        if (!live) {
          setSuggestion(value);
        }
      })
      .catch((reason: unknown) => {
        if (!live) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    return () => {
      unlisten?.();
    };
  }, []);

  const title = suggestion?.title ?? (error ? "Could not read the suggestion" : "Reading suggestion");

  return (
    <main className="hud">
      <div className="hud__ambient" />

      <header className="hud__header">
        <div className="hud__brand">
          <span className="hud__badge">Aura</span>
          <span className="hud__status">{suggestion?.source ?? "live"}</span>
        </div>
        <span className="hud__meta">Alt-tab</span>
      </header>

      <section className="hud__content">
        <div className="hud__focus-panel">
          <p className="hud__label">Focused task</p>
          <h1>{title}</h1>
          {suggestion?.detail && <p className="detail">{suggestion.detail}</p>}
          {suggestion?.reason && <p className="reason">{suggestion.reason}</p>}
          {error && <p className="reason">{error}</p>}
        </div>
      </section>

      <div className="hud__tabs" role="list" aria-label="Open windows">
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
    </main>
  );
}
