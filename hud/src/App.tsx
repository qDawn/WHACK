import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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

    invoke<Suggestion>("read_suggestion")
      .then(setSuggestion)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, []);

  const title = suggestion?.title ?? (error ? "Could not read the suggestion" : "Reading suggestion");

  return (
    <main className="hud">
      <p className="kicker">Aura · {suggestion?.source ?? "waiting"}</p>
      <h1>{title}</h1>
      {suggestion && <p className="detail">{suggestion.detail}</p>}
      {suggestion && <p className="reason">{suggestion.reason}</p>}
      {error && <p className="reason">{error}</p>}
      <p className="hint">Ctrl+Alt+Space shows and hides this panel</p>
    </main>
  );
}
