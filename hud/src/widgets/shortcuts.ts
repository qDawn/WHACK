import { resetDashboard } from "../layout/defaults";
import type { StageSize } from "../layout/geometry";
import type { LayoutDocument } from "../layout/types";

/**
 * Shortcut widget state lives in `%LOCALAPPDATA%\aura\widget-state.json`.
 * Each instance id maps to `{ variant, shortcuts }`. The layout record keeps
 * placement and the size preset. Reset leaves these records in place.
 */

export const SHORTCUT_WIDGET_TYPE = "shortcuts";

/** Fixed boxes on the 24px stage grid. The user picks one; the frame does not resize freely. */
export const SHORTCUT_VARIANTS = [
  { id: "compact", width: 288, height: 192, columns: 2 },
  { id: "regular", width: 360, height: 216, columns: 3 },
  { id: "wide", width: 480, height: 192, columns: 4 },
] as const;

export type ShortcutVariantId = (typeof SHORTCUT_VARIANTS)[number]["id"];

export type ShortcutRecord = {
  variant: string;
  shortcuts: string[];
};

export type WidgetStateDocument = Record<string, unknown>;

export type ShortcutAction = {
  kind: string;
  title: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function shortcutColumns(variant: string): number {
  const match = SHORTCUT_VARIANTS.find((item) => item.id === variant);
  return match ? match.columns : SHORTCUT_VARIANTS[0].columns;
}

export function emptyShortcutRecord(variant: string): ShortcutRecord {
  return { variant, shortcuts: [] };
}

export function shortcutMark(title: string): string {
  const first = Array.from(title.trim())[0];
  return first ? first.toLocaleUpperCase() : "•";
}

/**
 * Library mock. A constant: it does not read the suggestion snapshot, the catalog, or widget state.
 */
export const SHORTCUT_PREVIEW_LABELS = ["One", "Two", "Three", "Four"] as const;

export function shortcutPreviewModel(): readonly string[] {
  return SHORTCUT_PREVIEW_LABELS;
}

export function shortcutLabel(
  id: string,
  catalog: readonly { id: string; title: string }[],
  actions: readonly { kind: string; title: string }[],
): string {
  for (const entry of catalog) {
    if (entry.id === id && entry.title.length > 0) return entry.title;
  }
  for (const action of actions) {
    if (action.kind === id && action.title.length > 0) return action.title;
  }
  return id;
}

/** Snapshot action kinds, in order, with duplicates removed. An empty snapshot stays empty. */
export function suggestionCandidates(actions: readonly { kind: string }[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const action of actions) {
    if (seen.has(action.kind)) continue;
    seen.add(action.kind);
    next.push(action.kind);
  }
  return next;
}

export function openActionRequest(kind: string): { kind: string } {
  return { kind };
}

/** Launch only while arranging is off. Edit mode configures the instance instead. */
export function shortcutActivation(editMode: boolean, kind: string): { kind: string } | null {
  if (editMode || kind.length === 0) return null;
  return openActionRequest(kind);
}

function shortcutIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || seen.has(item)) continue;
    seen.add(item);
    next.push(item);
  }
  return next;
}

export function shortcutRecord(file: WidgetStateDocument, instanceId: string, fallbackVariant: string): ShortcutRecord {
  const raw = file[instanceId];
  if (!isRecord(raw)) return emptyShortcutRecord(fallbackVariant);
  const variant = typeof raw.variant === "string" && raw.variant.length > 0 ? raw.variant : fallbackVariant;
  return { variant, shortcuts: shortcutIds(raw.shortcuts) };
}

function recordExtras(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const extras: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "variant" || key === "shortcuts") continue;
    extras[key] = item;
  }
  return extras;
}

export function withShortcutRecord(file: WidgetStateDocument, instanceId: string, record: ShortcutRecord): WidgetStateDocument {
  return {
    ...file,
    [instanceId]: {
      ...recordExtras(file[instanceId]),
      variant: record.variant,
      shortcuts: record.shortcuts.slice(),
    },
  };
}

export function addShortcutId(record: ShortcutRecord, id: string): ShortcutRecord {
  if (id.length === 0 || record.shortcuts.includes(id)) return record;
  return { ...record, shortcuts: [...record.shortcuts, id] };
}

export function removeShortcutId(record: ShortcutRecord, id: string): ShortcutRecord {
  if (!record.shortcuts.includes(id)) return record;
  return { ...record, shortcuts: record.shortcuts.filter((item) => item !== id) };
}

export function withVariant(record: ShortcutRecord, variant: string): ShortcutRecord {
  if (!SHORTCUT_VARIANTS.some((item) => item.id === variant) || record.variant === variant) return record;
  return { ...record, variant };
}

export function parseWidgetState(text: string): WidgetStateDocument | null {
  if (text.trim().length === 0) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) return null;
    return value;
  } catch {
    return null;
  }
}

export function serializeWidgetState(file: WidgetStateDocument): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * Reset clears shortcut widgets from the stage and does not create one.
 * Records already in the widget-state file stay where they are.
 */
export function resetKeepsWidgetState(
  current: LayoutDocument,
  stage: StageSize,
  viewportWidth: number,
  viewportHeight: number,
  widgetState: WidgetStateDocument,
): { layout: LayoutDocument; widgetState: WidgetStateDocument } {
  return {
    layout: resetDashboard(current, stage, viewportWidth, viewportHeight),
    widgetState,
  };
}
