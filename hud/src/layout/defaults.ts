import { clamp, type StageSize } from "./geometry";
import { LAYOUT_VERSION, type LayoutDocument } from "./types";

export const NAV_HEIGHT = 56;
export const NAV_WIDTH = 146;
export const STACK_WIDTH = 220;
export const PANEL_GAP = 12;
/** Nav, the 12px gap, and the window stack. Matches the previous left rail. */
export const NOTE_WIDTH = NAV_WIDTH + PANEL_GAP + STACK_WIDTH;

type MeasuredStage = StageSize;

function suggestionsWidth(viewportWidth: number): number {
  return clamp(300, viewportWidth * 0.22, 380);
}

/**
 * The arrangement the CSS used before panels could move, as fractions of a measured stage.
 * The note stays bottom-left until the user drags it. Its height is the open height.
 */
export function defaultLayout(stage: MeasuredStage, viewportWidth: number, viewportHeight: number): LayoutDocument {
  const width = Math.max(stage.width, 1);
  const height = Math.max(stage.height, 1);
  const suggestions = Math.min(suggestionsWidth(viewportWidth), width);
  const noteWidth = Math.min(NOTE_WIDTH, width);
  const noteHeight = Math.min(viewportHeight * 0.4, Math.max(120, height - NAV_HEIGHT - PANEL_GAP), height);

  return {
    version: LAYOUT_VERSION,
    snap: true,
    animations: true,
    shortcuts: [],
    widgets: [],
    panels: {
      nav: { x: 0, y: 0, z: 4, visible: true },
      "window-stack": {
        x: clamp((NAV_WIDTH + PANEL_GAP) / width, 0, 1),
        y: 0,
        z: 2,
        visibility: "visible",
      },
      suggestions: {
        x: clamp((width - suggestions) / width, 0, 1),
        y: 0,
        z: 3,
        visibility: "visible",
      },
      "quick-note": {
        x: 0,
        y: clamp((height - noteHeight) / height, 0, 1),
        z: 2,
        visibility: "visible",
        width: clamp(noteWidth / width, 0, 1),
        height: clamp(noteHeight / height, 0, 1),
        anchor: "bottom-left",
      },
    },
  };
}

/** Default arrangement, keeping the current animations toggle. */
export function resetDashboard(
  current: LayoutDocument,
  stage: MeasuredStage,
  viewportWidth: number,
  viewportHeight: number,
): LayoutDocument {
  const next = defaultLayout(stage, viewportWidth, viewportHeight);
  return { ...next, animations: current.animations };
}
