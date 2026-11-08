import type { NotePlacement } from "./types";

/** CSS pixels. Snap and resize both use this grid. */
export const GRID_PX = 24;

/** How close a panel must be, in CSS pixels, before the grid pulls it in. */
export const SNAP_THRESHOLD = 12;

export const STAGE_INSET = 28;

export const MIN_NOTE_WIDTH = 200;
export const MIN_NOTE_HEIGHT = 140;

/** Keep at least this much of a panel inside the stage while dragging. */
export const PANEL_MARGIN = 48;

export type StageSize = {
  width: number;
  height: number;
};

export type FrameBox = {
  left: number;
  top: number;
  bottom?: number;
  width?: number;
  height?: number;
  anchor: "bottom-left" | "free";
};

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Ease toward the nearest grid line once `value` is inside the threshold.
 * Outside the threshold the pointer position is unchanged.
 */
export function magnetic(value: number, enabled: boolean): number {
  if (!enabled) return value;
  const nearest = Math.round(value / GRID_PX) * GRID_PX;
  const delta = nearest - value;
  const distance = Math.abs(delta);
  if (distance > SNAP_THRESHOLD) return value;
  const proximity = 1 - distance / SNAP_THRESHOLD;
  const gain = 0.4 + 0.6 * proximity * proximity;
  return value + delta * gain;
}

/** Land on the grid line at the end of a drag when still inside the threshold. */
export function settle(value: number, enabled: boolean): number {
  if (!enabled) return value;
  const nearest = Math.round(value / GRID_PX) * GRID_PX;
  return Math.abs(nearest - value) <= SNAP_THRESHOLD ? nearest : value;
}

export function clampStagePoint(x: number, y: number, stage: StageSize): { x: number; y: number } {
  return {
    x: clamp(x, 0, Math.max(0, stage.width - PANEL_MARGIN)),
    y: clamp(y, 0, Math.max(0, stage.height - PANEL_MARGIN)),
  };
}

export function panelFrame(panel: { x: number; y: number }, stage: StageSize): FrameBox {
  return {
    left: STAGE_INSET + panel.x * stage.width,
    top: STAGE_INSET + panel.y * stage.height,
    anchor: "free",
  };
}

export function noteSize(note: NotePlacement, stage: StageSize): { width: number; height: number } {
  const width = note.width * stage.width;
  const height = note.height * stage.height;
  return {
    width: clamp(width, Math.min(MIN_NOTE_WIDTH, stage.width), Math.max(stage.width, 1)),
    height: clamp(height, Math.min(MIN_NOTE_HEIGHT, stage.height), Math.max(stage.height, 1)),
  };
}

export function noteFrame(note: NotePlacement, stage: StageSize, open: boolean): FrameBox {
  const size = noteSize(note, stage);
  if (note.anchor === "bottom-left") {
    return {
      left: STAGE_INSET + note.x * stage.width,
      top: STAGE_INSET + Math.max(0, stage.height - size.height),
      bottom: STAGE_INSET,
      width: size.width,
      height: open ? size.height : undefined,
      anchor: "bottom-left",
    };
  }
  return {
    left: STAGE_INSET + note.x * stage.width,
    top: STAGE_INSET + note.y * stage.height,
    width: size.width,
    height: open ? size.height : undefined,
    anchor: "free",
  };
}
