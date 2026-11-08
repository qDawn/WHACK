/**
 * Dashboard arrangement saved at `%LOCALAPPDATA%\aura\layout.json`.
 *
 * Positions, and the note's width and height, are fractions (0–1) of the
 * stage content box — the area inside the 28px inset. `animations` is the
 * show and dismiss motion toggle. The nav panel stores `visible` instead of
 * the three-state `visibility` used by every other piece. Edit mode is not a
 * field here. It is the React `editMode` flag (`data-editing` on
 * `.dashboard`). Unknown top-level keys are written back beside these fields.
 * Widget runtime state belongs in `%LOCALAPPDATA%\aura\widget-state.json`.
 * A shortcut instance stores its ordered ids and chosen variant there, under
 * its instance id. `shortcuts` on this document still round-trips and is not
 * rendered. The scratchpad file remains the quick note's text.
 */

export const LAYOUT_VERSION = 1;

export type Visibility = "visible" | "minimised" | "hidden";

export const PANEL_IDS = ["nav", "window-stack", "suggestions", "quick-note"] as const;

export type PanelId = (typeof PANEL_IDS)[number];

export function isPanelId(id: string): id is PanelId {
  return (PANEL_IDS as readonly string[]).includes(id);
}

export const PANEL_LABELS: Record<PanelId, string> = {
  nav: "Navigation",
  "window-stack": "Window stack",
  suggestions: "Suggestions",
  "quick-note": "Quick note",
};

export type Placement = {
  x: number;
  y: number;
  z: number;
  visibility: Visibility;
};

/**
 * Sidebar placement. `visible` is the only show/hide control.
 * Legacy `visibility` of `minimised` or `hidden` loads as `visible: false`.
 */
export type NavPlacement = {
  x: number;
  y: number;
  z: number;
  visible: boolean;
};

/** The quick note is the only piece that stores a size. `anchor` stays bottom-left until the note is moved. */
export type NotePlacement = Placement & {
  width: number;
  height: number;
  anchor: "bottom-left" | "free";
};

export type WidgetInstance = {
  id: string;
  type: string;
  variant: string;
  x: number;
  y: number;
  z: number;
  visibility: Visibility;
};

export type LayoutDocument = {
  version: typeof LAYOUT_VERSION;
  snap: boolean;
  /** Show and dismiss motion. Reset dashboard does not change this. */
  animations: boolean;
  shortcuts: string[];
  widgets: WidgetInstance[];
  panels: {
    nav: NavPlacement;
    "window-stack": Placement;
    suggestions: Placement;
    "quick-note": NotePlacement;
  };
};

export type CatalogEntry = {
  id: string;
  title: string;
};

export type CatalogStatus = "loading" | "ready" | "unavailable" | "error";
