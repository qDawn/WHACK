import { clamp, clampStagePoint, type StageSize } from "./geometry";
import {
  isPanelId,
  LAYOUT_VERSION,
  type LayoutDocument,
  type NotePlacement,
  type Placement,
  type Visibility,
  type WidgetInstance,
} from "./types";
import { widgetByType } from "../widgets/registry";

const KIND = /^[A-Za-z0-9_-]+$/;

const KNOWN_KEYS = new Set(["version", "snap", "animations", "shortcuts", "widgets", "panels"]);

export type ParsedLayout = {
  layout: LayoutDocument;
  extras: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fraction(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return clamp(value, 0, 1);
}

function order(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function visibility(value: unknown): Visibility | null {
  if (value === "visible" || value === "minimised" || value === "hidden") return value;
  return null;
}

function placement(value: unknown): Placement | null {
  if (!isRecord(value)) return null;
  const x = fraction(value.x);
  const y = fraction(value.y);
  const z = order(value.z);
  const shown = visibility(value.visibility);
  if (x === null || y === null || z === null || shown === null) return null;
  return { x, y, z, visibility: shown };
}

function notePlacement(value: unknown): NotePlacement | null {
  const base = placement(value);
  if (!base || !isRecord(value)) return null;
  const width = fraction(value.width);
  const height = fraction(value.height);
  const anchor = value.anchor === "bottom-left" || value.anchor === "free" ? value.anchor : null;
  if (width === null || height === null || anchor === null) return null;
  return { ...base, width, height, anchor };
}

function shortcuts(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const next: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !KIND.test(item) || seen.has(item)) continue;
    seen.add(item);
    next.push(item);
  }
  return next;
}

function widgetInstance(value: unknown): WidgetInstance | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  const type = typeof value.type === "string" ? value.type : "";
  const variant = typeof value.variant === "string" ? value.variant : "";
  const base = placement(value);
  if (!base || id.length === 0 || type.length === 0 || variant.length === 0) return null;
  if (isPanelId(type)) return null;
  return { id, type, variant, ...base };
}

function widgets(value: unknown): WidgetInstance[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const next: WidgetInstance[] = [];
  for (const item of value) {
    const widget = widgetInstance(item);
    if (!widget || seen.has(widget.type)) continue;
    seen.add(widget.type);
    next.push(widget);
  }
  return next;
}

export function parseLayout(raw: string): ParsedLayout | null {
  if (raw.trim().length === 0) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== LAYOUT_VERSION || typeof value.snap !== "boolean") return null;
  const animations = typeof value.animations === "boolean" ? value.animations : true;
  const pinned = shortcuts(value.shortcuts);
  const instances = widgets(value.widgets);
  if (!pinned || !instances || !isRecord(value.panels)) return null;
  const nav = placement(value.panels.nav);
  const stack = placement(value.panels["window-stack"]);
  const suggestions = placement(value.panels.suggestions);
  const note = notePlacement(value.panels["quick-note"]);
  if (!nav || !stack || !suggestions || !note) return null;

  const extras: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!KNOWN_KEYS.has(key)) extras[key] = item;
  }

  return {
    layout: enforceNoteCompany({
      version: LAYOUT_VERSION,
      snap: value.snap,
      animations,
      shortcuts: pinned,
      widgets: instances,
      panels: {
        nav,
        "window-stack": stack,
        suggestions,
        "quick-note": note,
      },
    }),
    extras,
  };
}

function roundFraction(value: number): number {
  return Math.round(value * 100000) / 100000;
}

function writePlacement(panel: Placement): Placement {
  return {
    x: roundFraction(panel.x),
    y: roundFraction(panel.y),
    z: panel.z,
    visibility: panel.visibility,
  };
}

function writeNote(panel: NotePlacement): NotePlacement {
  return {
    ...writePlacement(panel),
    width: roundFraction(panel.width),
    height: roundFraction(panel.height),
    anchor: panel.anchor,
  };
}

export function serializeLayout(layout: LayoutDocument, extras: Record<string, unknown>): string {
  return `${JSON.stringify(
    {
      version: layout.version,
      snap: layout.snap,
      animations: layout.animations,
      shortcuts: layout.shortcuts,
      widgets: layout.widgets.map((widget) => ({
        id: widget.id,
        type: widget.type,
        variant: widget.variant,
        ...writePlacement(widget),
      })),
      panels: {
        nav: writePlacement(layout.panels.nav),
        "window-stack": writePlacement(layout.panels["window-stack"]),
        suggestions: writePlacement(layout.panels.suggestions),
        "quick-note": writeNote(layout.panels["quick-note"]),
      },
      ...extras,
    },
    null,
    2,
  )}\n`;
}

type Counted = { visibility: Visibility };

function others(layout: LayoutDocument): Counted[] {
  return [
    layout.panels.nav,
    layout.panels["window-stack"],
    layout.panels.suggestions,
    ...layout.widgets.filter((widget) => widgetByType(widget.type)),
  ];
}

/** The quick note cannot be the only component left on the stage. */
export function enforceNoteCompany(layout: LayoutDocument): LayoutDocument {
  const rest = others(layout);
  if (rest.some((item) => item.visibility === "visible")) return layout;
  const target: Visibility = rest.some((item) => item.visibility === "minimised") ? "minimised" : "hidden";
  const note = layout.panels["quick-note"];
  const leaveVisible = note.visibility === "visible";
  const dropPill = note.visibility === "minimised" && target === "hidden";
  if (!leaveVisible && !dropPill) return layout;
  if (note.visibility === target) return layout;
  return {
    ...layout,
    panels: {
      ...layout.panels,
      "quick-note": { ...note, visibility: target },
    },
  };
}

export function noteCanBeVisible(layout: LayoutDocument): boolean {
  return others(layout).some((item) => item.visibility === "visible");
}

function highestZ(layout: LayoutDocument): number {
  return Math.max(
    layout.panels.nav.z,
    layout.panels["window-stack"].z,
    layout.panels.suggestions.z,
    layout.panels["quick-note"].z,
    ...layout.widgets.map((widget) => widget.z),
  );
}

export function bringToFront(layout: LayoutDocument, id: string): LayoutDocument {
  const maxZ = highestZ(layout);
  const current = zOf(layout, id);
  if (current === null) return layout;
  const tied = countZ(layout, maxZ) > 1;
  if (current === maxZ && !tied) return layout;
  return setZ(layout, id, maxZ + 1);
}

function zOf(layout: LayoutDocument, id: string): number | null {
  if (id === "nav") return layout.panels.nav.z;
  if (id === "window-stack") return layout.panels["window-stack"].z;
  if (id === "suggestions") return layout.panels.suggestions.z;
  if (id === "quick-note") return layout.panels["quick-note"].z;
  return layout.widgets.find((widget) => widget.id === id)?.z ?? null;
}

function countZ(layout: LayoutDocument, z: number): number {
  const panels = [
    layout.panels.nav.z,
    layout.panels["window-stack"].z,
    layout.panels.suggestions.z,
    layout.panels["quick-note"].z,
  ];
  return panels.filter((value) => value === z).length + layout.widgets.filter((widget) => widget.z === z).length;
}

function setZ(layout: LayoutDocument, id: string, z: number): LayoutDocument {
  if (id === "nav") return { ...layout, panels: { ...layout.panels, nav: { ...layout.panels.nav, z } } };
  if (id === "window-stack") {
    return { ...layout, panels: { ...layout.panels, "window-stack": { ...layout.panels["window-stack"], z } } };
  }
  if (id === "suggestions") {
    return { ...layout, panels: { ...layout.panels, suggestions: { ...layout.panels.suggestions, z } } };
  }
  if (id === "quick-note") {
    return {
      ...layout,
      panels: { ...layout.panels, "quick-note": { ...layout.panels["quick-note"], z } },
    };
  }
  return {
    ...layout,
    widgets: layout.widgets.map((widget) => (widget.id === id ? { ...widget, z } : widget)),
  };
}

function withVisibility(layout: LayoutDocument, id: string, shown: Visibility): LayoutDocument {
  if (id === "nav") {
    return { ...layout, panels: { ...layout.panels, nav: { ...layout.panels.nav, visibility: shown } } };
  }
  if (id === "window-stack") {
    return {
      ...layout,
      panels: { ...layout.panels, "window-stack": { ...layout.panels["window-stack"], visibility: shown } },
    };
  }
  if (id === "suggestions") {
    return {
      ...layout,
      panels: { ...layout.panels, suggestions: { ...layout.panels.suggestions, visibility: shown } },
    };
  }
  if (id === "quick-note") {
    return {
      ...layout,
      panels: { ...layout.panels, "quick-note": { ...layout.panels["quick-note"], visibility: shown } },
    };
  }
  return {
    ...layout,
    widgets: layout.widgets.map((widget) => (widget.id === id ? { ...widget, visibility: shown } : widget)),
  };
}

export function setVisibility(layout: LayoutDocument, id: string, shown: Visibility): LayoutDocument {
  return enforceNoteCompany(withVisibility(layout, id, shown));
}

export function place(layout: LayoutDocument, id: string, xPx: number, yPx: number, stage: StageSize): LayoutDocument {
  const point = clampStagePoint(xPx, yPx, stage);
  const x = clamp(point.x / stage.width, 0, 1);
  const y = clamp(point.y / stage.height, 0, 1);
  if (id === "quick-note") {
    return {
      ...layout,
      panels: {
        ...layout.panels,
        "quick-note": { ...layout.panels["quick-note"], x, y, anchor: "free" },
      },
    };
  }
  if (id === "nav") return { ...layout, panels: { ...layout.panels, nav: { ...layout.panels.nav, x, y } } };
  if (id === "window-stack") {
    return { ...layout, panels: { ...layout.panels, "window-stack": { ...layout.panels["window-stack"], x, y } } };
  }
  if (id === "suggestions") {
    return { ...layout, panels: { ...layout.panels, suggestions: { ...layout.panels.suggestions, x, y } } };
  }
  return {
    ...layout,
    widgets: layout.widgets.map((widget) => (widget.id === id ? { ...widget, x, y } : widget)),
  };
}

export function resizeNote(layout: LayoutDocument, widthPx: number, heightPx: number, stage: StageSize): LayoutDocument {
  const note = layout.panels["quick-note"];
  const width = clamp(widthPx / Math.max(stage.width, 1), 0, 1);
  const height = clamp(heightPx / Math.max(stage.height, 1), 0, 1);
  const y = note.anchor === "bottom-left" ? clamp((stage.height - heightPx) / Math.max(stage.height, 1), 0, 1) : note.y;
  return {
    ...layout,
    panels: {
      ...layout.panels,
      "quick-note": { ...note, width, height, y },
    },
  };
}

export function pinShortcut(layout: LayoutDocument, id: string): LayoutDocument {
  if (!KIND.test(id) || layout.shortcuts.includes(id)) return layout;
  return { ...layout, shortcuts: [...layout.shortcuts, id] };
}

export function unpinShortcut(layout: LayoutDocument, id: string): LayoutDocument {
  if (!layout.shortcuts.includes(id)) return layout;
  return { ...layout, shortcuts: layout.shortcuts.filter((item) => item !== id) };
}

export function reorderShortcut(layout: LayoutDocument, sourceId: string, targetId: string): LayoutDocument {
  if (sourceId === targetId) return layout;
  const from = layout.shortcuts.indexOf(sourceId);
  const to = layout.shortcuts.indexOf(targetId);
  if (from < 0 || to < 0) return layout;
  const next = layout.shortcuts.slice();
  next.splice(from, 1);
  next.splice(to, 0, sourceId);
  return { ...layout, shortcuts: next };
}

export function insertWidget(layout: LayoutDocument, type: string, variant: string, stage: StageSize): LayoutDocument | null {
  const registration = widgetByType(type);
  if (!registration || isPanelId(type)) return null;
  if (layout.widgets.some((widget) => widget.type === type)) return null;
  const size = registration.sizes.find((item) => item.id === variant) ?? registration.sizes[0];
  if (!size) return null;
  const instance: WidgetInstance = {
    id: type,
    type,
    variant: size.id,
    x: clamp((stage.width - size.width) / 2 / Math.max(stage.width, 1), 0, 1),
    y: clamp((stage.height - size.height) / 2 / Math.max(stage.height, 1), 0, 1),
    z: highestZ(layout) + 1,
    visibility: "visible",
  };
  return enforceNoteCompany({ ...layout, widgets: [...layout.widgets, instance] });
}
