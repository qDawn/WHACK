import { bringToFront, enforceNoteCompany, insertWidget, placeWidgetInstance, setVisibility } from "../layout/document";
import type { StageSize } from "../layout/geometry";
import type { LayoutDocument, WidgetInstance } from "../layout/types";
import { widgetRegistry, type WidgetRegistration } from "./registry";
import { emptyShortcutRecord, SHORTCUT_WIDGET_TYPE, withShortcutRecord, type WidgetStateDocument } from "./shortcuts";

export type WidgetRemovalChoice = "keep" | "delete" | "cancel";

export type LibraryRestoreRow = {
  id: string;
  variant: string;
};

export type LibraryEntry = {
  type: string;
  title: string;
  description: string;
  canAdd: boolean;
  restores: readonly LibraryRestoreRow[];
};

type LibraryRegistration = {
  type: string;
  title: string;
  description: string;
  allowMultiple?: boolean;
  sizes: readonly { id: string }[];
};

const INSTANCE_SUFFIX = /^[1-9]\d*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function instanceBelongs(entry: { type: string; allowMultiple?: boolean }, id: string): boolean {
  if (id === entry.type) return true;
  if (entry.allowMultiple !== true) return false;
  const prefix = `${entry.type}-`;
  if (!id.startsWith(prefix)) return false;
  return INSTANCE_SUFFIX.test(id.slice(prefix.length));
}

function readVariant(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback;
  const variant = value.variant;
  return typeof variant === "string" && variant.length > 0 ? variant : fallback;
}

function registrationForId(id: string): WidgetRegistration | undefined {
  return widgetRegistry.find((entry) => instanceBelongs(entry, id));
}

/**
 * Every registration stays in the catalog.
 * `allowMultiple` widgets stay addable and list retained instances that are off the stage.
 * A single-instance widget stays visible after it is placed, without a second Add.
 */
export function libraryEntries(
  widgets: readonly Pick<WidgetInstance, "id" | "type" | "variant" | "visibility">[],
  widgetState: WidgetStateDocument,
  registrations: readonly LibraryRegistration[] = widgetRegistry,
): LibraryEntry[] {
  const onStage = new Set(widgets.filter((widget) => widget.visibility !== "hidden").map((widget) => widget.id));
  return registrations.map((entry) => {
    const restores: LibraryRestoreRow[] = [];
    const seen = new Set<string>();
    for (const widget of widgets) {
      if (widget.type !== entry.type || widget.visibility !== "hidden") continue;
      seen.add(widget.id);
      restores.push({ id: widget.id, variant: widget.variant });
    }
    const fallback = entry.sizes[0]?.id ?? "";
    for (const [id, raw] of Object.entries(widgetState)) {
      if (seen.has(id) || onStage.has(id) || !instanceBelongs(entry, id) || !isRecord(raw)) continue;
      seen.add(id);
      restores.push({ id, variant: readVariant(raw, fallback) });
    }
    const placed = widgets.some((widget) => widget.type === entry.type);
    const canAdd = entry.allowMultiple === true || (!placed && restores.length === 0);
    return {
      type: entry.type,
      title: entry.title,
      description: entry.description,
      canAdd,
      restores,
    };
  });
}

function detachWidget(layout: LayoutDocument, id: string): LayoutDocument {
  if (!layout.widgets.some((widget) => widget.id === id)) return layout;
  return enforceNoteCompany({
    ...layout,
    widgets: layout.widgets.filter((widget) => widget.id !== id),
  });
}

/** Cancel returns the same objects. Keep drops the stage entry and leaves the blob. Delete drops both. */
export function applyWidgetRemoval(
  layout: LayoutDocument,
  widgetState: WidgetStateDocument,
  id: string,
  choice: WidgetRemovalChoice,
): { layout: LayoutDocument; widgetState: WidgetStateDocument } {
  if (choice === "cancel" || !layout.widgets.some((widget) => widget.id === id)) {
    return { layout, widgetState };
  }
  const removed = detachWidget(layout, id);
  if (choice === "keep" || !(id in widgetState)) return { layout: removed, widgetState };
  const nextState = { ...widgetState };
  delete nextState[id];
  return { layout: removed, widgetState: nextState };
}

/**
 * Put a kept instance back. An id already on the stage is left alone.
 * A hidden layout entry keeps its position. A removed entry uses the new-widget offset.
 * The widget-state blob is not written.
 */
export function restoreWidgetInstance(
  layout: LayoutDocument,
  widgetState: WidgetStateDocument,
  id: string,
  stage: StageSize,
): { layout: LayoutDocument; widgetState: WidgetStateDocument } {
  const existing = layout.widgets.find((widget) => widget.id === id);
  if (existing) {
    if (existing.visibility !== "hidden") return { layout, widgetState };
    return { layout: bringToFront(setVisibility(layout, id, "visible"), id), widgetState };
  }
  const registration = registrationForId(id);
  const raw = widgetState[id];
  if (!registration || !isRecord(raw)) return { layout, widgetState };
  const fallback = registration.sizes[0]?.id ?? "";
  const next = placeWidgetInstance(layout, id, registration.type, readVariant(raw, fallback), stage);
  if (!next) return { layout, widgetState };
  return { layout: next, widgetState };
}

/** Add creates a fresh id and skips ids that already have a blob. It does not copy another instance's shortcuts. */
export function addWidgetInstance(
  layout: LayoutDocument,
  widgetState: WidgetStateDocument,
  type: string,
  variant: string,
  stage: StageSize,
): { layout: LayoutDocument; widgetState: WidgetStateDocument } | null {
  const next = insertWidget(layout, type, variant, stage, Object.keys(widgetState));
  if (!next) return null;
  const created = next.widgets.find((widget) => !layout.widgets.some((current) => current.id === widget.id));
  if (!created || created.type !== SHORTCUT_WIDGET_TYPE || widgetState[created.id] !== undefined) {
    return { layout: next, widgetState };
  }
  return {
    layout: next,
    widgetState: withShortcutRecord(widgetState, created.id, emptyShortcutRecord(created.variant)),
  };
}
