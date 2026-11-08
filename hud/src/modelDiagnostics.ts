export const DIAGNOSTIC_STAGE_IDS = [
  "initialisation",
  "availability",
  "requestGeneration",
  "contextSupplied",
  "requestDelivery",
  "inferenceCompletion",
  "responseRetrieval",
  "recommendationRanking",
  "frontendDelivery",
  "lastError",
] as const;

export type DiagnosticStageId = (typeof DIAGNOSTIC_STAGE_IDS)[number];

export type DiagnosticStatus = "idle" | "ok" | "skipped" | "error";

export type DiagnosticStage = {
  status?: string;
  message?: string;
  keyPresent?: boolean;
  host?: string;
  model?: string;
  fields?: string[];
  noteLength?: number;
  clipboardLength?: number;
  windowTitlePresent?: boolean;
  processName?: string;
  clipboardIncluded?: boolean;
  historyRecent?: number;
  historyFrequent?: number;
};

export type ModelDiagnostics = Partial<Record<DiagnosticStageId, DiagnosticStage>>;

export type DiagnosticRow = {
  id: DiagnosticStageId;
  label: string;
  status: DiagnosticStatus;
  detail: string;
};

const LABELS: Record<DiagnosticStageId, string> = {
  initialisation: "Initialisation",
  availability: "Availability",
  requestGeneration: "Request generation",
  contextSupplied: "Context supplied",
  requestDelivery: "Request delivery",
  inferenceCompletion: "Inference completion",
  responseRetrieval: "Response retrieval",
  recommendationRanking: "Recommendation ranking",
  frontendDelivery: "Frontend delivery",
  lastError: "Last error",
};

function isStatus(value: string | undefined): value is DiagnosticStatus {
  return value === "idle" || value === "ok" || value === "skipped" || value === "error";
}

function stageDetail(id: DiagnosticStageId, stage: DiagnosticStage | undefined): string {
  if (!stage) return "";
  const parts: string[] = [];
  if (typeof stage.message === "string" && stage.message.trim().length > 0) parts.push(stage.message.trim());
  if (id === "availability") {
    if (typeof stage.keyPresent === "boolean") parts.push(stage.keyPresent ? "Key present" : "Key missing");
    if (typeof stage.host === "string" && stage.host.length > 0) parts.push(stage.host);
    if (typeof stage.model === "string" && stage.model.length > 0) parts.push(stage.model);
  }
  if (id === "contextSupplied") {
    if (Array.isArray(stage.fields) && stage.fields.length > 0) parts.push(stage.fields.join(", "));
    if (typeof stage.noteLength === "number") parts.push(`note length ${stage.noteLength}`);
    if (typeof stage.clipboardLength === "number") parts.push(`clipboard length ${stage.clipboardLength}`);
    if (typeof stage.windowTitlePresent === "boolean") {
      parts.push(stage.windowTitlePresent ? "window title present" : "no window title");
    }
    if (typeof stage.processName === "string" && stage.processName.length > 0) parts.push(stage.processName);
    if (typeof stage.historyRecent === "number") parts.push(`recent ${stage.historyRecent}`);
    if (typeof stage.historyFrequent === "number") parts.push(`frequent ${stage.historyFrequent}`);
  }
  return parts.join(" · ");
}

/** One row per stage. Missing stages stay idle. Note text, clipboard text, and the key are not read. */
export function diagnosticRows(diagnostics: ModelDiagnostics | null | undefined): DiagnosticRow[] {
  return DIAGNOSTIC_STAGE_IDS.map((id) => {
    const stage = diagnostics?.[id];
    const status = isStatus(stage?.status) ? stage.status : "idle";
    return {
      id,
      label: LABELS[id],
      status,
      detail: stageDetail(id, stage),
    };
  });
}

/** A single suggestions-panel line when the model is off or the last attempt failed. */
export function modelStatusLine(diagnostics: ModelDiagnostics | null | undefined): string | null {
  if (!diagnostics) return null;
  const lastError = diagnostics.lastError;
  if (lastError?.status === "error") {
    const message = lastError.message?.trim();
    return message && message.length > 0 ? message : "Model request failed";
  }
  const availability = diagnostics.availability;
  if (availability?.status === "error" || availability?.status === "skipped") {
    const message = availability.message?.trim();
    return message && message.length > 0 ? message : "Model is off";
  }
  return null;
}

/** Not a launch. The watcher treats this type as "consider once". */
export function hudShownMessage(): { protocol: "aura"; type: "hud.shown" } {
  return { protocol: "aura", type: "hud.shown" };
}
