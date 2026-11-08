import { diagnosticRows, hudShownMessage, modelStatusLine, type ModelDiagnostics } from "./modelDiagnostics";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const secret = "sk-live-secret-value";
const note = "NOTEBODY-TOKEN-9481";
const clip = "CLIPBOARD-TOKEN-9481";

const failed: ModelDiagnostics = {
  initialisation: { status: "ok", message: "Model advisor started" },
  availability: {
    status: "ok",
    message: "Model is available.",
    keyPresent: true,
    host: "api.openai.com",
    model: "gpt-4o-mini",
  },
  requestGeneration: { status: "ok", message: "Chat request built" },
  contextSupplied: {
    status: "ok",
    message: "Context fields included",
    fields: ["process", "window", "note", "history", "clipboard"],
    noteLength: note.length,
    clipboardLength: clip.length,
    windowTitlePresent: true,
    processName: "Code.exe",
  },
  requestDelivery: { status: "error", message: "HTTP 401" },
  inferenceCompletion: { status: "skipped", message: "No completion" },
  responseRetrieval: { status: "skipped", message: "No reply" },
  recommendationRanking: { status: "skipped", message: "No model ranking" },
  frontendDelivery: { status: "ok", message: "Snapshot published" },
  lastError: { status: "error", message: "HTTP 401" },
};

const rows = diagnosticRows(failed);
check(rows.length === 10, "every stage is listed");
check(rows.map((row) => row.id).join(",") === "initialisation,availability,requestGeneration,contextSupplied,requestDelivery,inferenceCompletion,responseRetrieval,recommendationRanking,frontendDelivery,lastError", "stage order is fixed");
check(rows.find((row) => row.id === "availability")?.detail.includes("Key present"), "availability says the key is present");
check(rows.find((row) => row.id === "availability")?.detail.includes("api.openai.com"), "availability shows the host");
check(rows.find((row) => row.id === "availability")?.detail.includes("gpt-4o-mini"), "availability shows the model name");
check(rows.find((row) => row.id === "contextSupplied")?.detail.includes(`note length ${note.length}`), "context shows the note length");
check(rows.find((row) => row.id === "contextSupplied")?.detail.includes(`clipboard length ${clip.length}`), "context shows the clipboard length");
check(modelStatusLine(failed) === "HTTP 401", "an error is one status line");

const text = JSON.stringify(rows);
check(!text.includes(secret), "rows do not include an api key");
check(!text.includes(note), "rows do not include the note body");
check(!text.includes(clip), "rows do not include the clipboard text");

const off = modelStatusLine({
  availability: { status: "error", message: "Model is off. No API key.", keyPresent: false, host: "api.openai.com", model: "gpt-4o-mini" },
  lastError: { status: "error", message: "Model is off. No API key." },
});
check(off === "Model is off. No API key.", "a missing key is shown as off");

check(
  modelStatusLine({
    availability: { status: "skipped", message: "Model is off." },
    lastError: { status: "idle" },
  }) === "Model is off.",
  "an unconfigured model is shown as off",
);

check(
  modelStatusLine({
    availability: { status: "ok", message: "Model is available.", keyPresent: true, host: "api.openai.com", model: "gpt-4o-mini" },
    lastError: { status: "idle" },
  }) === null,
  "a working model has no status line",
);

check(modelStatusLine(null) === null, "no diagnostics yet has no status line");
check(diagnosticRows(null).every((row) => row.status === "idle"), "a missing report lists idle stages");

const shown = hudShownMessage();
check(JSON.stringify(shown) === '{"protocol":"aura","type":"hud.shown"}', "hud.shown is the consider signal and not a launch");

console.log("model diagnostics tests passed");
