import { layoutStack, SELECTED_SCALE } from "./stackLayout";
import {
  STACK_MOTION_MS,
  cardRole,
  commitIndexBurst,
  previewHwndForSelection,
  replaceSelection,
  selectedPreviewImage,
  selectionAfterHover,
  selectionAfterShrink,
  selectionFrame,
  settleSelection,
  slideTargetFor,
  titleForSelection,
} from "./stackMotion";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const windows = ["0", "1", "2", "3", "4"].map((hwnd) => ({ hwnd: `hwnd-${hwnd}`, title: `Window ${hwnd}` }));
const images: Record<string, string> = {
  "hwnd-0": "image-0",
  "hwnd-1": "image-1",
  "hwnd-2": "image-2",
  "hwnd-3": "image-3",
  "hwnd-4": "image-4",
};

check(STACK_MOTION_MS >= 280 && STACK_MOTION_MS <= 320, "the slide lasts about 280–320ms");

const burst = commitIndexBurst(windows.length, [0, 3, 1, 4]);
check(burst.index === 4, "a burst 0 → 3 → 1 → 4 leaves the committed index at 4");
check(Object.keys(burst).sort().join(",") === "index,token", "the commit stores no queued index");
let settled = burst;
for (const token of [burst.token - 3, burst.token - 2, burst.token - 1]) {
  settled = settleSelection(settled, token);
}
check(settled.index === 4, "no intermediate index is applied after the burst");
check(settled.token === burst.token, "a stale settle does not mint a new commit");
check(settleSelection(settled, settled.token).index === 4, "settling the current motion keeps the latest index");
check(replaceSelection(settled, 4, windows.length).index === 4, "repeating the latest index stays on 4");

const frame = selectionFrame(windows, burst.index);
check(frame.index === 4, "the frame index is the committed index");
check(frame.previewHwnd === "hwnd-4", "the preview hwnd is window 4, not an earlier window");
check(previewHwndForSelection(windows, burst) === windows[4].hwnd, "preview hwnd is read from the committed index");
check(frame.title === "Window 4", "the title is window 4's title");
check(titleForSelection(windows, burst) === windows[4].title, "title stays tied to the committed index");
check(selectedPreviewImage(images, frame.previewHwnd) === "image-4", "the preview image is window 4's image");
check(selectedPreviewImage(images, "hwnd-0") !== selectedPreviewImage(images, frame.previewHwnd), "an earlier preview is not the committed one");

const hovered = selectionAfterHover(4, 2, windows.length);
check(hovered.index === 4, "hovering index 2 while selected is 4 does not change the commit");
check(previewHwndForSelection(windows, hovered) === windows[4].hwnd, "hover does not swap the preview hwnd");
check(titleForSelection(windows, hovered) === windows[4].title, "hover does not swap the title");
check(cardRole(4, hovered.index, 2) === "selected", "the selected card stays selected while another card is hovered");
check(cardRole(2, hovered.index, 2) === "hovered", "the hovered card is only hovered");
check(cardRole(2, hovered.index, 2) !== "selected", "a hovered unselected card is not selected");
check(cardRole(0, hovered.index, 2) === "idle", "a card that is neither selected nor hovered stays idle");
check(cardRole(4, 4, 4) === "selected", "a selected card that is also hovered stays selected");
check(cardRole(1, 4, 4) === "idle", "hover on the selected card does not highlight a neighbour");

const clamped = selectionAfterShrink(4, 3);
check(clamped.index === 2, "an index past the end clamps to the last card");
const clampedAgain = selectionAfterShrink(clamped.index, 3);
check(clampedAgain.index === 2, "clamping the same list again stays on that last card");
const shorter = windows.slice(0, 3);
check(previewHwndForSelection(shorter, clamped) === shorter[2].hwnd, "the clamped preview hwnd is the last remaining card");
check(titleForSelection(shorter, clamped) === shorter[2].title, "the clamped title is the last remaining card");
check(selectionFrame(shorter, 4).index === 2, "a frame past the end uses the clamped index");
check(selectionFrame(shorter, 4).previewHwnd === shorter[2].hwnd, "a frame past the end previews the clamped card");

const roomy = { containerWidth: 960, containerHeight: 320 };
const alone = slideTargetFor(1, 0, roomy.containerWidth, roomy.containerHeight);
const aloneNudged = slideTargetFor(1, 4, roomy.containerWidth, roomy.containerHeight);
check(alone.cardCount === 1, "one card has a single slide target");
check(alone.index === 0 && aloneNudged.index === 0, "one card has no other slide target");
check(alone.translateX === aloneNudged.translateX, "nudging a single card does not create a second target");
check(!("targets" in alone), "the slide target is not a list of waypoints");
const lone = layoutStack({ count: 1, selectedIndex: alone.index, ...roomy });
const loneCentre = lone.cards[0].x + lone.translateX + lone.cards[0].width / 2;
check(Math.abs(loneCentre - roomy.containerWidth / 2) <= 1, "the single card stays centred");
check(lone.cards[0].scale === SELECTED_SCALE, "the single card keeps the selected scale");

const empty = selectionFrame([], 3);
check(empty.index === 0, "an empty list has no card to select");
check(empty.previewHwnd === null, "an empty list has no selected preview hwnd");
check(empty.title === null, "an empty list has no selected title");
check(selectedPreviewImage(images, empty.previewHwnd) === null, "an empty list has no selected preview image");
check(slideTargetFor(0, 2, roomy.containerWidth, roomy.containerHeight).cardCount === 0, "an empty list has no slide card");

const atStart = layoutStack({ count: windows.length, selectedIndex: 0, ...roomy });
const atEnd = layoutStack({ count: windows.length, selectedIndex: burst.index, ...roomy });
const gap = (layout: typeof atStart, index: number) =>
  layout.cards[index].x + layout.translateX - (layout.cards[index - 1].x + layout.translateX);
check(Math.abs(gap(atStart, 1) - gap(atEnd, 1)) < 0.001, "a new index slides the row without spreading the overlap");
check(atEnd.cards[4].z > atEnd.cards[3].z && atEnd.cards[4].z > atEnd.cards[0].z, "the new front card is immediately above the others");
check(atEnd.cards[4].scale === SELECTED_SCALE, "the committed card keeps the selected scale");
const endCentre = atEnd.cards[4].x + atEnd.translateX + atEnd.cards[4].width / 2;
check(Math.abs(endCentre - roomy.containerWidth / 2) <= 1, "the committed card is the centred card");

console.log("stack motion tests passed");
