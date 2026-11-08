import { defaultLayout } from "../layout/defaults";
import { insertWidget } from "../layout/document";
import { widgetRegistry } from "./registry";
import {
  addWidgetInstance,
  applyWidgetRemoval,
  libraryEntries,
  restoreWidgetInstance,
} from "./library";
import {
  SHORTCUT_PREVIEW_LABELS,
  SHORTCUT_WIDGET_TYPE,
  shortcutPreviewModel,
  shortcutRecord,
  withShortcutRecord,
  type WidgetStateDocument,
} from "./shortcuts";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const stage = { width: 1280, height: 720 };

function twoShortcuts(): { layout: NonNullable<ReturnType<typeof insertWidget>>; file: WidgetStateDocument; first: string; second: string } {
  const fresh = defaultLayout(stage, 1440, 900);
  const firstLayout = insertWidget(fresh, SHORTCUT_WIDGET_TYPE, "wide", stage);
  check(firstLayout !== null, "the first shortcut widget can be placed");
  const layout = insertWidget(firstLayout, SHORTCUT_WIDGET_TYPE, "compact", stage);
  check(layout !== null && layout.widgets.length === 2, "two shortcut widgets can be placed");
  const first = layout.widgets[0].id;
  const second = layout.widgets[1].id;
  let file: WidgetStateDocument = {};
  file = withShortcutRecord(file, first, { variant: "wide", shortcuts: ["mail", "notes"] });
  file = withShortcutRecord(file, second, { variant: "compact", shortcuts: ["mail"] });
  return { layout, file, first, second };
}

const placed = twoShortcuts();
const kept = applyWidgetRemoval(placed.layout, placed.file, placed.first, "keep");
check(!kept.layout.widgets.some((widget) => widget.id === placed.first), "keep takes the instance off the stage");
check(kept.layout.widgets.some((widget) => widget.id === placed.second), "keep leaves the other instance on the stage");
check(kept.widgetState === placed.file, "keep leaves the widget-state object untouched");
check(kept.widgetState[placed.first] === placed.file[placed.first], "keep leaves that instance blob untouched");
check(shortcutRecord(kept.widgetState, placed.first, "compact").shortcuts.join(",") === "mail,notes", "keep keeps the shortcut ids");
check(shortcutRecord(kept.widgetState, placed.first, "compact").variant === "wide", "keep keeps the variant");

const restored = restoreWidgetInstance(kept.layout, kept.widgetState, placed.first, stage);
const restoredWidget = restored.layout.widgets.find((widget) => widget.id === placed.first);
check(restoredWidget !== undefined, "restore puts the same id back on the stage");
check(restored.layout.widgets.filter((widget) => widget.id === placed.first).length === 1, "restore adds that id once");
check(restored.widgetState === placed.file, "restore does not write a new blob");
check(restoredWidget.variant === "wide", "restore uses the saved variant");
check(shortcutRecord(restored.widgetState, placed.first, "compact").shortcuts.join(",") === "mail,notes", "restore leaves the shortcut ids in place");
check(restoredWidget.x !== 0 || restoredWidget.y !== 0, "a restored instance is not forced to 0,0");
const shadow = insertWidget(kept.layout, SHORTCUT_WIDGET_TYPE, "wide", stage, []);
check(shadow !== null, "the offset rule can place another shortcut widget");
const shadowWidget = shadow.widgets.find((widget) => !kept.layout.widgets.some((current) => current.id === widget.id));
check(shadowWidget !== undefined && restoredWidget.x === shadowWidget.x && restoredWidget.y === shadowWidget.y, "a removed entry comes back on the new-widget offset");

const already = restoreWidgetInstance(restored.layout, restored.widgetState, placed.first, stage);
check(already.layout === restored.layout, "restore of an id already on the stage does nothing");
check(already.widgetState === restored.widgetState, "a no-op restore does not write widget state");
check(already.layout.widgets.filter((widget) => widget.id === placed.first).length === 1, "restore does not duplicate an id that is already on the stage");

const hiddenLayout = {
  ...placed.layout,
  widgets: placed.layout.widgets.map((widget) => (widget.id === placed.first ? { ...widget, visibility: "hidden" as const } : widget)),
};
const shown = restoreWidgetInstance(hiddenLayout, placed.file, placed.first, stage);
const shownWidget = shown.layout.widgets.find((widget) => widget.id === placed.first);
check(shownWidget !== undefined && shownWidget.visibility === "visible", "a hidden layout entry can be shown again");
check(shownWidget.x === placed.layout.widgets[0].x && shownWidget.y === placed.layout.widgets[0].y, "restore keeps the layout position while the entry is still there");
check(shown.widgetState === placed.file, "showing a hidden entry does not write the blob");
check(shown.layout.widgets.length === hiddenLayout.widgets.length, "showing a hidden entry does not add another widget");

const deleted = applyWidgetRemoval(placed.layout, placed.file, placed.first, "delete");
check(!deleted.layout.widgets.some((widget) => widget.id === placed.first), "delete takes the instance off the stage");
check(!(placed.first in deleted.widgetState), "delete removes that id from widget state");
check(shortcutRecord(deleted.widgetState, placed.second, "compact").shortcuts.join(",") === "mail", "delete leaves the other blob alone");
const added = addWidgetInstance(deleted.layout, deleted.widgetState, SHORTCUT_WIDGET_TYPE, "compact", stage);
check(added !== null, "a widget can be added after a delete");
const created = added.layout.widgets.find((widget) => widget.id !== placed.second);
check(created !== undefined, "add places a shortcut widget");
check(shortcutRecord(added.widgetState, created.id, "compact").shortcuts.length === 0, "the new instance starts empty");
check(
  !shortcutRecord(added.widgetState, created.id, "compact").shortcuts.includes("mail") &&
    !shortcutRecord(added.widgetState, created.id, "compact").shortcuts.includes("notes"),
  "a later add does not resurrect the deleted shortcut ids",
);
check(placed.first in added.widgetState ? shortcutRecord(added.widgetState, placed.first, "compact").shortcuts.length === 0 : true, "a reused instance id does not bring the deleted blob back");

const cancelled = applyWidgetRemoval(placed.layout, placed.file, placed.first, "cancel");
check(cancelled.layout === placed.layout, "cancel leaves the stage as it was");
check(cancelled.widgetState === placed.file, "cancel leaves the blob as it was");
check(cancelled.layout.widgets.some((widget) => widget.id === placed.first), "cancel keeps the instance on the stage");
check(shortcutRecord(cancelled.widgetState, placed.first, "compact").shortcuts.join(",") === "mail,notes", "cancel keeps the shortcut ids");

const catalog = libraryEntries(placed.layout.widgets, placed.file);
const shortcutRow = catalog.find((entry) => entry.type === SHORTCUT_WIDGET_TYPE);
check(catalog.length === widgetRegistry.length, "the library lists every registered widget");
check(shortcutRow !== undefined, "the library catalog still includes the shortcut widget when two instances are on the stage");
check(shortcutRow.canAdd === true, "an allowMultiple widget stays addable while instances are on the stage");
check(shortcutRow.restores.length === 0, "instances on the stage are not offered as restore rows");
const keptRows = libraryEntries(kept.layout.widgets, kept.widgetState);
const keptShortcut = keptRows.find((entry) => entry.type === SHORTCUT_WIDGET_TYPE);
check(keptShortcut !== undefined && keptShortcut.restores.some((row) => row.id === placed.first), "a kept instance is listed for restore");
check(!JSON.stringify(keptShortcut).includes("mail") && !JSON.stringify(keptShortcut).includes("notes"), "a restore row does not carry shortcut titles");

const fresh = defaultLayout(stage, 1440, 900);
const one = addWidgetInstance(fresh, {}, SHORTCUT_WIDGET_TYPE, "compact", stage);
check(one !== null && one.layout.widgets.length === 1, "the first add places one shortcut widget");
const two = addWidgetInstance(one.layout, one.widgetState, SHORTCUT_WIDGET_TYPE, "wide", stage);
check(two !== null && two.layout.widgets.length === 2, "add while one instance exists places another");
check(two.layout.widgets[0].id !== two.layout.widgets[1].id, "add while one instance exists creates a different id");

const retained = withShortcutRecord({}, "shortcuts-1", { variant: "wide", shortcuts: ["notes"] });
const skipped = addWidgetInstance(fresh, retained, SHORTCUT_WIDGET_TYPE, "compact", stage);
check(skipped !== null && skipped.layout.widgets[0].id !== "shortcuts-1", "add skips an id that already has a retained blob");
check(shortcutRecord(skipped.widgetState, "shortcuts-1", "compact").shortcuts[0] === "notes", "add does not rewrite the retained blob");
check(shortcutRecord(skipped.widgetState, skipped.layout.widgets[0].id, "compact").shortcuts.length === 0, "the fresh instance starts empty");

const single = [
  {
    type: "scratch",
    title: "Scratch",
    description: "One scratch pad.",
    sizes: [{ id: "a" }],
  },
] as const;
const beforeSingle = libraryEntries([], {}, single);
check(beforeSingle.length === 1 && beforeSingle[0].canAdd && beforeSingle[0].restores.length === 0, "a single-instance widget can be added once");
const afterSingle = libraryEntries(
  [{ id: "scratch", type: "scratch", variant: "a", visibility: "visible" }],
  { scratch: { variant: "a", title: "Godot Editor" } },
  single,
);
check(afterSingle.length === 1, "a single-instance widget stays in the catalog after it is added");
check(afterSingle[0].canAdd === false, "a single-instance widget does not offer a second add");
check(afterSingle[0].restores.length === 0, "an instance on the stage is not a restore row");
check(!JSON.stringify(afterSingle).includes("Godot Editor"), "the library row does not copy blob titles");

const snapshotTitles = ["Mailbox", "Godot Editor"];
const catalogTitles = ["Browser", "Notes"];
const preview = shortcutPreviewModel();
check(preview === SHORTCUT_PREVIEW_LABELS, "the preview model is a constant");
check(shortcutPreviewModel() === preview, "the preview model always returns that constant");
check(shortcutPreviewModel.length === 0, "the preview model is not a function of actions or catalog entries");
const previewText = preview.join("\n");
for (const title of [...snapshotTitles, ...catalogTitles, "mail", "notes"]) {
  check(!previewText.includes(title), "the static preview does not contain snapshot titles or catalog results");
}

console.log("widget library tests passed");
