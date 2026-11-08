/**
 * Horizontal overlapping window stack.
 *
 * Cards share one row. Each origin sits STEP_RATIO of a card width past the
 * previous one, so a neighbour covers most of the selected card and only a
 * sliver stays visible. `translateX` shifts that whole row until the selected
 * card's centre is the container centre. A new index is a new result: nothing
 * is queued inside this function.
 *
 * More cards make the card smaller, width and height together, down to
 * MIN_CARD_WIDTH × MIN_CARD_HEIGHT. When the container is smaller than that,
 * the floor shrinks to the container instead. Past the floor the size stays
 * put and `scroll` is set once the row no longer fits.
 */

export const MIN_CARD_WIDTH = 140;
export const MIN_CARD_HEIGHT = 88;

/** Distance between successive card origins, as a fraction of card width. */
export const STEP_RATIO = 0.2;

/** Extra shrink per additional card, so a longer row is smaller even when it still fits. */
const COUNT_SHRINK = 0.08;

export const SELECTED_SCALE = 1.06;

const ASPECT = MIN_CARD_WIDTH / MIN_CARD_HEIGHT;

export type StackLayoutInput = {
  count: number;
  selectedIndex: number;
  containerWidth: number;
  containerHeight: number;
};

export type StackCardLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  scale: number;
};

export type StackLayout = {
  cards: StackCardLayout[];
  /** Added to every card's x. Centres the selected card in the container. */
  translateX: number;
  scroll: boolean;
  step: number;
  contentWidth: number;
};

export type StackPointerKind = "hover" | "scrub" | "click";

function emptyLayout(): StackLayout {
  return { cards: [], translateX: 0, scroll: false, step: 0, contentWidth: 0 };
}

function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  if (index < 0) return 0;
  if (index > count - 1) return count - 1;
  return index;
}

/** Usable card floor. Narrower or shorter containers shrink the 140×88 floor to fit. */
export function cardFloor(containerWidth: number, containerHeight: number): { width: number; height: number } {
  const boxWidth = containerWidth > 0 ? containerWidth : 1;
  const boxHeight = containerHeight > 0 ? containerHeight : 1;
  let width = Math.min(MIN_CARD_WIDTH, boxWidth);
  let height = width / ASPECT;
  if (height > boxHeight) {
    height = boxHeight;
    width = height * ASPECT;
  }
  if (width > boxWidth) {
    width = boxWidth;
    height = width / ASPECT;
  }
  return { width, height };
}

export function layoutStack(input: StackLayoutInput): StackLayout {
  const count = Math.max(0, Math.floor(input.count));
  if (count <= 0) return emptyLayout();

  const boxWidth = input.containerWidth > 0 ? input.containerWidth : MIN_CARD_WIDTH;
  const boxHeight = input.containerHeight > 0 ? input.containerHeight : MIN_CARD_HEIGHT;
  const selected = clampIndex(input.selectedIndex, count);
  const floor = cardFloor(boxWidth, boxHeight);
  const span = 1 + (count - 1) * STEP_RATIO;
  const widthLimit = Math.min(boxWidth, boxHeight * ASPECT);
  const countScale = 1 / (1 + (count - 1) * COUNT_SHRINK);
  let width = Math.min(widthLimit * countScale, boxWidth / span);
  if (width < floor.width) width = floor.width;
  if (width > boxWidth) width = boxWidth;
  let height = width / ASPECT;
  if (height > boxHeight) {
    height = boxHeight;
    width = Math.min(boxWidth, height * ASPECT);
    height = width / ASPECT;
  }
  if (width < floor.width) width = floor.width;
  if (height < floor.height) height = floor.height;

  const step = width * STEP_RATIO;
  const y = Math.max(0, (boxHeight - height) / 2);
  const cards: StackCardLayout[] = [];
  for (let index = 0; index < count; index += 1) {
    const distance = Math.abs(index - selected);
    cards.push({
      x: index * step,
      y,
      width,
      height,
      z: count - distance,
      scale: index === selected ? SELECTED_SCALE : 1,
    });
  }
  const selectedCard = cards[selected];
  const translateX = boxWidth / 2 - (selectedCard.x + selectedCard.width / 2);
  const contentWidth = width + (count - 1) * step;
  return {
    cards,
    translateX,
    scroll: contentWidth > boxWidth + 0.5,
    step,
    contentWidth,
  };
}

/** Hover never replaces the selection. */
export function selectionIndexAfterHover(selectedIndex: number, hoverIndex: number): number {
  return pointerResolution("hover", selectedIndex, hoverIndex).selectedIndex;
}

/** Hover highlights only. A scrub changes selection without activating. A click does both. */
export function pointerResolution(
  kind: StackPointerKind,
  selectedIndex: number,
  targetIndex: number,
): { selectedIndex: number; activate: boolean } {
  if (kind === "hover") return { selectedIndex, activate: false };
  const next = kind === "scrub" || kind === "click" ? targetIndex : selectedIndex;
  return { selectedIndex: next, activate: kind === "click" };
}

/**
 * Dragging the strip to the left advances the selection. `deltaX` is the
 * pointer movement since the drag started. Release is not an activation.
 */
export function indexAfterDrag(startIndex: number, deltaX: number, step: number, count: number): number {
  if (count <= 0) return 0;
  const safeStep = step > 1 ? step : 1;
  const shifted = Math.round(-deltaX / safeStep);
  return clampIndex(startIndex + shifted, count);
}
