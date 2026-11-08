/** How long the sidebar takes to slide off the nearest screen edge. */
export const SIDEBAR_SLIDE_MS = 280;

export type SidebarEdge = "left" | "right";

export type SidebarMotion = {
  visible: boolean;
  /** CSS transition for the slide. `none` shows or hides immediately. */
  transition: string;
  /** Edge handle. Present only while the sidebar is off. */
  handle: boolean;
  /** The sidebar does not keep the gear menu. */
  gear: false;
};

/**
 * Nearest horizontal screen edge.
 * The sidebar sits in the left half when its center is left of the screen midpoint.
 */
export function sidebarEdge(centerX: number, screenWidth: number): SidebarEdge {
  if (!(screenWidth > 0)) return "left";
  return centerX < screenWidth / 2 ? "left" : "right";
}

/**
 * Translate X, in CSS pixels, that clears the sidebar past `edge`.
 * Left: `-(panelLeft + panelWidth)`. Right: `screenWidth - panelLeft`.
 */
export function sidebarOffscreenX(
  edge: SidebarEdge,
  panelLeft: number,
  panelWidth: number,
  screenWidth: number,
): number {
  if (edge === "left") return -(panelLeft + panelWidth);
  return screenWidth - panelLeft;
}

/** Immediate when animations are off or the OS asks for reduced motion. */
export function sidebarTransition(animations: boolean, reduceMotion: boolean): string {
  if (!animations || reduceMotion) return "none";
  return `transform ${SIDEBAR_SLIDE_MS}ms ease`;
}

/**
 * Show, hide, and restore motion for the sidebar.
 * A transform transition reverses if visibility flips again before it finishes.
 */
export function sidebarMotion(visible: boolean, animations: boolean, reduceMotion: boolean): SidebarMotion {
  return {
    visible,
    transition: sidebarTransition(animations, reduceMotion),
    handle: !visible,
    gear: false,
  };
}
