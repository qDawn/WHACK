import { dirtyWindows, indexAfterPreviewLoad, selectedPreviewHwnd, type PreviewWindow } from "./previewFreshness";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function same(actual: readonly string[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false;
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.every((hwnd, index) => hwnd === right[index]);
}

const stable: PreviewWindow[] = [
  { hwnd: "1", title: "Alpha" },
  { hwnd: "2", title: "Beta" },
  { hwnd: "3", title: "Gamma" },
];

const renamed: PreviewWindow[] = [
  { hwnd: "1", title: "Alpha" },
  { hwnd: "2", title: "Beta+" },
  { hwnd: "3", title: "Gamma" },
];

const titleDirty = dirtyWindows(stable, renamed, "1", "1");
check(same(titleDirty, ["2"]), "title change marks only that hwnd");
check(!titleDirty.includes("1") && !titleDirty.includes("3"), "unchanged inactive windows are not dirty");

const added: PreviewWindow[] = [...stable, { hwnd: "4", title: "Delta" }];
const appeared = dirtyWindows(stable, added, "1", "1");
check(same(appeared, ["4"]), "a new hwnd is dirty");
const removed = dirtyWindows(added, stable, "1", "1");
check(!removed.includes("4"), "a disappeared hwnd is not captured");
check(removed.length === 0, "a disappeared hwnd does not recapture the windows that remain");

const foreground = dirtyWindows(stable, stable, "3", "1");
check(same(foreground, ["3"]), "foreground change marks only the foreground hwnd");
check(!foreground.includes("1") && !foreground.includes("2"), "unchanged inactive windows are not dirty");
check(dirtyWindows(stable, stable, "9", "1").length === 0, "foreground change is ignored when that hwnd is not in the list");

const again = dirtyWindows(stable, stable, "3", "3");
check(again.length === 0, "a second call with the same lists and the same foreground is empty");
check(dirtyWindows(stable, stable, "1").length === 0, "a repeated poll with an unchanged foreground is empty");

const windows = [{ hwnd: "10" }, { hwnd: "20" }, { hwnd: "30" }];
check(selectedPreviewHwnd(windows, 0) === "10", "selected preview id follows selectedIndex 0");
check(selectedPreviewHwnd(windows, 1) === "20", "selected preview id follows selectedIndex 1");
check(selectedPreviewHwnd(windows, 2) === "30", "selected preview id follows selectedIndex 2");
check(selectedPreviewHwnd(windows, 4) === null, "a selectedIndex past the end has no preview id");
check(
  indexAfterPreviewLoad(1, "30", "20") === 1,
  "a loading flag for a non-selected card does not change the selection",
);
check(indexAfterPreviewLoad(2, "10", selectedPreviewHwnd(windows, 2)) === 2, "loading a neighbour keeps the selected index");

console.log("preview freshness tests passed");
