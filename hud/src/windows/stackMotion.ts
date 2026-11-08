/**
 * Interruptible window-stack selection.
 *
 * The committed index is the only index. A newer choice replaces it.
 * Nothing is queued, and a late settle cannot write an older index back.
 * Hover, the centred card, the preview, and the title all read this index.
 */

import { selectedPreviewHwnd } from "./previewFreshness";
import { layoutStack, selectionIndexAfterHover } from "./stackLayout";

/** One slide, ease-out. Matches the window-card transition in App.css. */
export const STACK_MOTION_MS = 300;

export type SelectionCommit = {
  index: number;
  /** Increments on every accepted replacement. A late settle carries an older token. */
  token: number;
};

export type SelectionFrame = {
  index: number;
  previewHwnd: string | null;
  title: string | null;
};

export type CardRole = "selected" | "hovered" | "idle";

export type SlideTarget = {
  index: number;
  translateX: number;
  cardCount: number;
};

export function clampSelectionIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  if (index < 0) return 0;
  if (index > count - 1) return count - 1;
  return index;
}

/** The newest choice. This does not remember a previous target. */
export function commitSelection(index: number, count: number): SelectionCommit {
  return { index: clampSelectionIndex(index, count), token: 1 };
}

/** Replace the committed index immediately. The previous index is dropped. */
export function replaceSelection(current: SelectionCommit, index: number, count: number): SelectionCommit {
  return { index: clampSelectionIndex(index, count), token: current.token + 1 };
}

/**
 * Apply each index in order. Each one replaces the commit.
 * The result is only the last index.
 */
export function commitIndexBurst(count: number, indexes: readonly number[]): SelectionCommit {
  let committed = commitSelection(0, count);
  if (indexes.length === 0) return committed;
  committed = commitSelection(indexes[0], count);
  for (let position = 1; position < indexes.length; position += 1) {
    committed = replaceSelection(committed, indexes[position], count);
  }
  return committed;
}

/**
 * Motion finishing does not choose a card. A token from an earlier
 * replacement is ignored, and even the current token leaves the index as it is.
 */
export function settleSelection(current: SelectionCommit, token: number): SelectionCommit {
  if (token !== current.token) return current;
  return current;
}

/** Hover highlights only. The committed index stays. */
export function selectionAfterHover(selectedIndex: number, hoverIndex: number, count: number): SelectionCommit {
  return commitSelection(selectionIndexAfterHover(selectedIndex, hoverIndex), count);
}

/** A list that no longer contains this index clamps to the last card, once. */
export function selectionAfterShrink(index: number, nextCount: number): SelectionCommit {
  return commitSelection(index, nextCount);
}

export function previewHwndForSelection(
  windows: readonly { hwnd: string }[],
  selection: { index: number },
): string | null {
  return selectedPreviewHwnd(windows, selection.index);
}

export function titleForSelection(
  windows: readonly { title: string }[],
  selection: { index: number },
): string | null {
  return windows[selection.index]?.title ?? null;
}

/** No hwnd means no preview image, including an empty window list. */
export function selectedPreviewImage(
  images: Readonly<Record<string, string>>,
  previewHwnd: string | null,
): string | null {
  if (!previewHwnd) return null;
  return images[previewHwnd] ?? null;
}

/** Preview, title, and the centred card are the same index. */
export function selectionFrame(windows: readonly { hwnd: string; title: string }[], index: number): SelectionFrame {
  const selection = commitSelection(index, windows.length);
  return {
    index: selection.index,
    previewHwnd: previewHwndForSelection(windows, selection),
    title: titleForSelection(windows, selection),
  };
}

/**
 * Selected wins over hover on the same card.
 * A different card may be hovered without becoming selected.
 */
export function cardRole(cardIndex: number, selectedIndex: number, hoverIndex: number | null): CardRole {
  if (cardIndex === selectedIndex) return "selected";
  if (hoverIndex !== null && hoverIndex !== selectedIndex && cardIndex === hoverIndex) return "hovered";
  return "idle";
}

/** One translate target: the committed card. A single card targets only itself. */
export function slideTargetFor(
  count: number,
  index: number,
  containerWidth: number,
  containerHeight: number,
): SlideTarget {
  const selection = commitSelection(index, count);
  const layout = layoutStack({
    count,
    selectedIndex: selection.index,
    containerWidth,
    containerHeight,
  });
  return {
    index: selection.index,
    translateX: layout.translateX,
    cardCount: layout.cards.length,
  };
}
