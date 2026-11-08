import {
  MIN_CARD_HEIGHT,
  MIN_CARD_WIDTH,
  indexAfterDrag,
  layoutStack,
  pointerResolution,
  selectionIndexAfterHover,
  type StackLayout,
} from "./stackLayout";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function visualLeft(layout: StackLayout, index: number): number {
  return layout.cards[index].x + layout.translateX;
}

function centreX(layout: StackLayout, index: number): number {
  const card = layout.cards[index];
  return visualLeft(layout, index) + card.width / 2;
}

function rect(layout: StackLayout, index: number): { left: number; right: number; top: number; bottom: number } {
  const card = layout.cards[index];
  const left = visualLeft(layout, index);
  return { left, right: left + card.width, top: card.y, bottom: card.y + card.height };
}

function intersects(
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
): boolean {
  return a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
}

function assertDeck(count: number, selectedIndex: number, containerWidth: number, containerHeight: number): StackLayout {
  const layout = layoutStack({ count, selectedIndex, containerWidth, containerHeight });
  check(layout.cards.length === count, `${count} cards are placed`);
  const selected = layout.cards[selectedIndex];
  check(Math.abs(centreX(layout, selectedIndex) - containerWidth / 2) <= 1, `selected card ${selectedIndex} of ${count} is centred`);
  for (const card of layout.cards) {
    check(card.z <= selected.z, "selected card has the highest z");
  }
  check(
    layout.cards.every((card, index) => index === selectedIndex || card.z < selected.z),
    "no other card shares the selected z",
  );
  check(selected.scale > 1, "selected card is slightly scaled up");
  for (let index = 0; index < count; index += 1) {
    if (index !== selectedIndex) check(layout.cards[index].scale < selected.scale, "unselected cards stay smaller");
  }
  const neighbours = [selectedIndex - 1, selectedIndex + 1].filter((index) => index >= 0 && index < count);
  const selectedRect = rect(layout, selectedIndex);
  for (const index of neighbours) {
    check(intersects(selectedRect, rect(layout, index)), `neighbour ${index} overlaps the selected card`);
  }
  if (count > 1) {
    const gap = Math.abs(visualLeft(layout, 1) - visualLeft(layout, 0));
    check(gap > 0, "successive cards are not piled on one origin");
    check(gap < selected.width * 0.45, "successive origins are much closer than a card width");
    for (let index = 1; index < count; index += 1) {
      check(visualLeft(layout, index) > visualLeft(layout, index - 1), "cards run left to right");
    }
  }
  return layout;
}

const roomy = { containerWidth: 960, containerHeight: 320 };

const single = assertDeck(1, 0, roomy.containerWidth, roomy.containerHeight);
check(Math.abs(single.cards[0].y + single.cards[0].height / 2 - roomy.containerHeight / 2) <= 1, "one card is centred vertically");
check(single.scroll === false, "one card does not scroll");

for (const selected of [0, 1, 2]) assertDeck(3, selected, 960, 320);
for (const selected of [0, 3, 7]) assertDeck(8, selected, 960, 320);

const one = layoutStack({ count: 1, selectedIndex: 0, ...roomy });
const three = layoutStack({ count: 3, selectedIndex: 1, ...roomy });
const eight = layoutStack({ count: 8, selectedIndex: 3, ...roomy });
check(three.cards[0].width < one.cards[0].width - 1, "three cards are narrower than one");
check(eight.cards[0].width < three.cards[0].width - 1, "eight cards are narrower than three");
check(three.cards[0].height < one.cards[0].height - 1, "three cards are shorter than one");
check(eight.cards[0].height < three.cards[0].height - 1, "eight cards are shorter than three");

for (const count of [1, 2, 3, 8, 12, 40, 80]) {
  const layout = layoutStack({ count, selectedIndex: 0, ...roomy });
  check(layout.cards[0].width + 0.01 >= MIN_CARD_WIDTH, `width stays at least ${MIN_CARD_WIDTH} for ${count} cards`);
  check(layout.cards[0].height + 0.01 >= MIN_CARD_HEIGHT, `height stays at least ${MIN_CARD_HEIGHT} for ${count} cards`);
}

const crowded = { containerWidth: 640, containerHeight: 240 };
const many = layoutStack({ count: 40, selectedIndex: 3, ...crowded });
const more = layoutStack({ count: 80, selectedIndex: 10, ...crowded });
check(many.scroll === true, "a very large count uses the scroll fallback");
check(more.scroll === true, "an even larger count still scrolls");
check(Math.abs(many.cards[0].width - MIN_CARD_WIDTH) < 0.01, "a very large count keeps the minimum width");
check(Math.abs(many.cards[0].height - MIN_CARD_HEIGHT) < 0.01, "a very large count keeps the minimum height");
check(Math.abs(more.cards[0].width - many.cards[0].width) < 0.01, "size does not keep shrinking past the minimum");
check(Math.abs(more.cards[0].height - many.cards[0].height) < 0.01, "height does not keep shrinking past the minimum");

const narrow = layoutStack({ count: 4, selectedIndex: 1, containerWidth: 100, containerHeight: 180 });
check(narrow.cards[0].width <= 100 + 0.01, "a narrower stage keeps the card inside the container");
check(narrow.cards[0].width + 0.01 >= Math.min(MIN_CARD_WIDTH, 100), "a narrower stage uses its own floor");
check(narrow.cards[0].height > 40, "a narrower stage keeps a visible card");

const sequence = [0, 4, 7, 2, 2, 5, 0];
const seen = sequence.map((selectedIndex) => layoutStack({ count: 8, selectedIndex, ...roomy }));
for (let index = 0; index < sequence.length; index += 1) {
  const again = layoutStack({ count: 8, selectedIndex: sequence[index], ...roomy });
  check(JSON.stringify(again) === JSON.stringify(seen[index]), "repeating an index returns the same layout");
  check(Math.abs(centreX(again, sequence[index]) - roomy.containerWidth / 2) <= 1, "each index recentres on its own");
}

const early = layoutStack({ count: 8, selectedIndex: 1, ...roomy });
const later = layoutStack({ count: 8, selectedIndex: 5, ...roomy });
const gapEarly = visualLeft(early, 3) - visualLeft(early, 2);
const gapLater = visualLeft(later, 3) - visualLeft(later, 2);
check(Math.abs(gapEarly - gapLater) < 0.001, "the overlap stays put while the row shifts");
check(Math.abs(visualLeft(early, 1) - visualLeft(later, 1)) > 1, "changing the selection shifts the whole row");

check(selectionIndexAfterHover(3, 0) === 3, "hover does not write the selection");
check(selectionIndexAfterHover(3, 6) === 3, "hover on another card does not write the selection");
check(selectionIndexAfterHover(3, 3) === 3, "hover on the selected card keeps it");
const hover = pointerResolution("hover", 3, 6);
check(hover.selectedIndex === 3 && hover.activate === false, "hover does not select or activate");
const scrub = pointerResolution("scrub", 3, 6);
check(scrub.selectedIndex === 6 && scrub.activate === false, "a scrub selects and does not activate");
const click = pointerResolution("click", 3, 6);
check(click.selectedIndex === 6 && click.activate === true, "a click selects and activates");

check(indexAfterDrag(2, 0, 40, 8) === 2, "a press with no movement keeps the index");
check(indexAfterDrag(2, -40, 40, 8) === 3, "dragging left selects the next card");
check(indexAfterDrag(2, 80, 40, 8) === 0, "dragging right selects earlier cards");
check(indexAfterDrag(0, 200, 40, 8) === 0, "drag clamps at the first card");
check(indexAfterDrag(7, -400, 40, 8) === 7, "drag clamps at the last card");

console.log("stack layout tests passed");
