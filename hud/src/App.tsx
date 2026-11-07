import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { suggestionFromFixture, type Suggestion } from "./suggestion";
import "./App.css";

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
      <p className="kicker">Aura · {suggestion?.source ?? "waiting"}</p>
      <h1>{title}</h1>
      {suggestion?.detail && <p className="detail">{suggestion.detail}</p>}
      {suggestion?.reason && <p className="reason">{suggestion.reason}</p>}
      {error && <p className="reason">{error}</p>}
      <p className="hint">Ctrl+Alt+Space shows and hides this panel</p>
    </main>
  );
}
