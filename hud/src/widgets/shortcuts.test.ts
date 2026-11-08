import { navControls } from "../layout/navModel";
import { defaultLayout, resetDashboard } from "../layout/defaults";
import { insertWidget, parseLayout, pinShortcut, serializeLayout } from "../layout/document";
import {
  addShortcutId,
  emptyShortcutRecord,
  openActionRequest,
  resetKeepsWidgetState,
  SHORTCUT_WIDGET_TYPE,
  shortcutActivation,
  shortcutRecord,
  suggestionCandidates,
  withShortcutRecord,
  type WidgetStateDocument,
} from "./shortcuts";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const stage = { width: 1280, height: 720 };

const fresh = defaultLayout(stage, 1440, 900);
check(fresh.widgets.length === 0, "a default layout has no widgets");
check(!fresh.widgets.some((widget) => widget.type === SHORTCUT_WIDGET_TYPE), "a default layout has no shortcut widget");
const freshAgain = parseLayout(serializeLayout(fresh, {}));
check(freshAgain !== null && freshAgain.layout.widgets.length === 0, "a round-tripped default layout still has no shortcut widget");

const pinned = pinShortcut(fresh, "notes");
const fromPins = resetDashboard(pinned, stage, 1440, 900);
check(fromPins.widgets.length === 0, "reset does not invent a shortcut widget from pins");

let placed = insertWidget(pinned, SHORTCUT_WIDGET_TYPE, "compact", stage);
check(placed !== null, "the first shortcut widget can be added");
placed = insertWidget(placed, SHORTCUT_WIDGET_TYPE, "wide", stage);
check(placed !== null && placed.widgets.length === 2, "two shortcut widgets can sit on the stage");
check(placed.widgets[0].type === SHORTCUT_WIDGET_TYPE && placed.widgets[1].type === SHORTCUT_WIDGET_TYPE, "both instances are shortcut widgets");
check(placed.widgets[0].id !== placed.widgets[1].id, "each instance has its own id");
check(placed.widgets[0].variant === "compact" && placed.widgets[1].variant === "wide", "each instance keeps its own size preset");
check(placed.widgets[0].x !== placed.widgets[1].x || placed.widgets[0].y !== placed.widgets[1].y, "later instances are offset");
check(placed.shortcuts[0] === "notes", "layout pins stay on the document");
check(emptyShortcutRecord(placed.widgets[0].variant).shortcuts.length === 0, "a new instance does not copy layout pins");

let mailAndNotes = addShortcutId(emptyShortcutRecord("compact"), "mail");
mailAndNotes = addShortcutId(mailAndNotes, "notes");
mailAndNotes = addShortcutId(mailAndNotes, "mail");
check(mailAndNotes.shortcuts.join(",") === "mail,notes", "adding an id twice keeps a single entry");

let mailOnSecond = addShortcutId(emptyShortcutRecord("wide"), "mail");
check(mailOnSecond.shortcuts.join(",") === "mail", "the same id may be stored on another instance");
check(mailOnSecond.variant === "wide" && mailAndNotes.variant === "compact", "the two records keep different variants");

let file: WidgetStateDocument = {};
file = withShortcutRecord(file, placed.widgets[0].id, mailAndNotes);
file = withShortcutRecord(file, placed.widgets[1].id, mailOnSecond);
check(shortcutRecord(file, placed.widgets[0].id, "compact").shortcuts.join(",") === "mail,notes", "the first instance keeps its own list");
check(shortcutRecord(file, placed.widgets[1].id, "compact").variant === "wide", "the second instance keeps its stored variant");
check(shortcutRecord(file, placed.widgets[1].id, "compact").shortcuts.join(",") === "mail", "the second instance keeps its own list");

const cleared = resetDashboard(placed, stage, 1440, 900);
check(cleared.widgets.length === 0, "reset removes shortcut widget instances");
check(!cleared.widgets.some((widget) => widget.type === SHORTCUT_WIDGET_TYPE), "reset does not create a shortcut widget");

const kept = resetKeepsWidgetState(placed, stage, 1440, 900, file);
check(kept.layout.widgets.length === 0, "reset drops the instances from the stage");
check(kept.widgetState === file, "reset leaves a retained widget-state blob in place");
check(shortcutRecord(kept.widgetState, placed.widgets[0].id, "compact").shortcuts[0] === "mail", "the retained list is still there");

const retained = withShortcutRecord({}, "shortcuts-1", { variant: "wide", shortcuts: ["notes"] });
const spawned = insertWidget(fresh, SHORTCUT_WIDGET_TYPE, "compact", stage, Object.keys(retained));
check(spawned !== null && spawned.widgets[0].id !== "shortcuts-1", "a new instance does not reuse a retained id");
check(shortcutRecord(retained, "shortcuts-1", "compact").shortcuts[0] === "notes", "the retained blob is not rewritten");
check(emptyShortcutRecord(spawned.widgets[0].variant).shortcuts.length === 0, "the new instance starts empty");

const reloaded = parseLayout(serializeLayout({ ...placed, shortcuts: ["notes", "mail"] }, {}));
check(reloaded !== null, "two shortcut widgets reload");
check(reloaded.layout.widgets.length === 2, "reload keeps both shortcut instances");
check(reloaded.layout.widgets[0].variant === "compact" && reloaded.layout.widgets[1].variant === "wide", "reload keeps each size preset");
check(reloaded.layout.shortcuts.join(",") === "notes,mail", "reload keeps layout pins");
const saved = JSON.parse(serializeLayout(reloaded.layout, {})) as { widgets: { shortcuts?: unknown; ids?: unknown }[] };
check(saved.widgets.every((widget) => widget.shortcuts === undefined && widget.ids === undefined), "shortcut ids are not stored on the layout placement");

const uniqueRaw = JSON.parse(serializeLayout(fresh, {})) as { widgets: unknown[] };
uniqueRaw.widgets = [
  { id: "scratch-1", type: "scratch", variant: "a", x: 0.1, y: 0.1, z: 1, visibility: "visible" },
  { id: "scratch-2", type: "scratch", variant: "a", x: 0.2, y: 0.2, z: 2, visibility: "visible" },
];
const unique = parseLayout(JSON.stringify(uniqueRaw));
check(unique !== null && unique.layout.widgets.length === 1, "a widget without allowMultiple still keeps a single instance");

const kinds = suggestionCandidates([{ kind: "mail" }, { kind: "notes" }, { kind: "mail" }, { kind: "browser" }]);
check(kinds.join(",") === "mail,notes,browser", "suggestion candidates are the snapshot kinds in order without duplicates");
check(suggestionCandidates([]).length === 0, "an empty snapshot yields an empty candidate list");

const request = openActionRequest("mail");
check(JSON.stringify(request) === '{"kind":"mail"}', "the launch request is only kind");
check(Object.keys(request).length === 1 && !("stayOpen" in request), "the launch request has no stay-open flag");
const whileEditing = shortcutActivation(true, "mail");
const whileUsing = shortcutActivation(false, "mail");
check(whileEditing === null, "edit mode does not launch");
check(whileUsing !== null && JSON.stringify(whileUsing) === '{"kind":"mail"}', "a click outside edit mode launches with kind only");

const controls = navControls();
const controlIds: readonly string[] = controls.map((control) => control.id);
const controlLabels: readonly string[] = controls.map((control) => control.label);
check(controlIds.includes("edit") && controlLabels.includes("Edit"), "Edit remains");
check(controlIds.includes("settings") && controlLabels.includes("Settings"), "Settings remains");
check(!controlIds.includes("shortcut-picker") && !controlLabels.includes("Shortcut picker"), "the nav model has no shortcut picker");

console.log("shortcut widget tests passed");
