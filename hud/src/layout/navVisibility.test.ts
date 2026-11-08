import { resetDashboard, defaultLayout } from "./defaults";
import { parseLayout, pinShortcut, place, serializeLayout, setNavVisible, setVisibility } from "./document";
import { SIDEBAR_SLIDE_MS, sidebarEdge, sidebarMotion, sidebarOffscreenX } from "./sidebar";
import type { LayoutDocument } from "./types";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Saved = {
  panels: {
    nav: { x: number; y: number; z: number; visible?: boolean; visibility?: string };
    "window-stack": { visibility: string };
    suggestions: { visibility: string };
    "quick-note": { visibility: string };
  };
  shortcuts: string[];
  animations: boolean;
};

function savedOf(layout: LayoutDocument, extras: Record<string, unknown> = {}): Saved {
  return JSON.parse(serializeLayout(layout, extras)) as Saved;
}

const stage = { width: 1280, height: 720 };

function parkedSidebar(): LayoutDocument {
  let layout = defaultLayout(stage, 1440, 900);
  layout = pinShortcut(layout, "notes");
  layout = pinShortcut(layout, "mail");
  layout = place(layout, "nav", 320, 80, stage);
  return {
    ...layout,
    panels: {
      ...layout.panels,
      nav: { ...layout.panels.nav, z: 11 },
    },
  };
}

function samePlace(layout: LayoutDocument, parked: LayoutDocument, label: string) {
  check(layout.panels.nav.x === parked.panels.nav.x, `${label} keeps x`);
  check(layout.panels.nav.y === parked.panels.nav.y, `${label} keeps y`);
  check(layout.panels.nav.z === parked.panels.nav.z, `${label} keeps z`);
  check(layout.shortcuts[0] === "notes" && layout.shortcuts[1] === "mail", `${label} keeps shortcuts`);
}

const parked = parkedSidebar();
check(parked.panels.nav.visible === true, "starts visible");
check(parked.panels.nav.x > 0 && parked.panels.nav.y > 0, "starts away from the origin");

const hidden = setNavVisible(parked, false);
check(hidden.panels.nav.visible === false, "hide turns the toggle off");
samePlace(hidden, parked, "hide");
check(hidden.panels["window-stack"].visibility === "visible", "hiding the sidebar leaves the window stack alone");
check(hidden.panels.suggestions.visibility === "visible", "hiding the sidebar leaves suggestions alone");
check(hidden.panels["quick-note"].visibility === "visible", "note stays while other panels are visible");

const hiddenJson = serializeLayout(hidden, { theme: "glass" });
const reloaded = parseLayout(hiddenJson);
check(reloaded !== null, "reload parses");
check(reloaded.layout.panels.nav.visible === false, "reload restores visible false");
check(reloaded.layout.panels.nav.x === savedOf(hidden).panels.nav.x, "reload keeps x");
check(reloaded.layout.panels.nav.y === savedOf(hidden).panels.nav.y, "reload keeps y");
check(reloaded.layout.panels.nav.z === 11, "reload keeps z");
check(reloaded.layout.shortcuts[0] === "notes" && reloaded.layout.shortcuts[1] === "mail", "reload keeps shortcuts");
check(reloaded.extras.theme === "glass", "reload keeps unknown layout keys");
check(!("visibility" in savedOf(hidden).panels.nav), "saved nav has no visibility field");
check(savedOf(hidden).panels.nav.visible === false, "saved nav stores visible false");
check(savedOf(hidden).panels["window-stack"].visibility === "visible", "other panels still store visibility");

const restored = setNavVisible(reloaded.layout, true);
check(restored.panels.nav.visible === true, "restore shows the sidebar");
check(restored.panels.nav.x === reloaded.layout.panels.nav.x, "restore keeps x");
check(restored.panels.nav.y === reloaded.layout.panels.nav.y, "restore keeps y");
check(restored.panels.nav.z === reloaded.layout.panels.nav.z, "restore keeps z");
check(restored.shortcuts[0] === "notes" && restored.shortcuts[1] === "mail", "restore keeps shortcuts");

const reset = resetDashboard({ ...hidden, animations: false }, stage, 1440, 900);
check(reset.panels.nav.visible === true, "reset shows the sidebar");
check(reset.animations === false, "reset keeps the animations toggle");
check(reset.panels["window-stack"].visibility === "visible", "reset restores other panels");

function legacy(visibility: "visible" | "minimised" | "hidden"): LayoutDocument {
  const base = savedOf(defaultLayout(stage, 1440, 900));
  const nav = { x: 0.25, y: 0.15, z: 9, visibility };
  const raw = JSON.stringify({ ...base, shortcuts: ["notes", "mail"], panels: { ...base.panels, nav } });
  const parsed = parseLayout(raw);
  check(parsed !== null, `legacy ${visibility} parses`);
  return parsed.layout;
}

const fromMinimised = legacy("minimised");
check(fromMinimised.panels.nav.visible === false, "legacy minimised loads off");
check(fromMinimised.panels.nav.x === 0.25 && fromMinimised.panels.nav.y === 0.15, "legacy minimised keeps x/y");
check(fromMinimised.panels.nav.z === 9, "legacy minimised keeps z");
check(fromMinimised.shortcuts[0] === "notes" && fromMinimised.shortcuts[1] === "mail", "legacy minimised keeps shortcuts");
check(savedOf(fromMinimised).panels.nav.visible === false, "legacy minimised writes visible false");
check(!("visibility" in savedOf(fromMinimised).panels.nav), "legacy minimised drops the old visibility field");

const fromHidden = legacy("hidden");
check(fromHidden.panels.nav.visible === false, "legacy hidden loads off");
check(fromHidden.panels.nav.x === 0.25 && fromHidden.panels.nav.z === 9, "legacy hidden keeps place");
check(savedOf(fromHidden).panels.nav.visible === false, "legacy hidden writes visible false");

const fromVisible = legacy("visible");
check(fromVisible.panels.nav.visible === true, "legacy visible loads on");
check(!("visibility" in savedOf(fromVisible).panels.nav), "legacy visible writes the boolean");

let company = defaultLayout(stage, 1440, 900);
company = setVisibility(company, "window-stack", "hidden");
company = setVisibility(company, "suggestions", "hidden");
check(company.panels["quick-note"].visibility === "visible", "a visible sidebar still counts as company");
company = setNavVisible(company, false);
check(company.panels.nav.visible === false, "sidebar off");
check(company.panels["quick-note"].visibility === "hidden", "sidebar off is not visible company");
check(company.panels.nav.x === 0 && company.panels.nav.y === 0, "note rule does not move the sidebar");

let mixed = defaultLayout(stage, 1440, 900);
mixed = setVisibility(mixed, "window-stack", "minimised");
mixed = setVisibility(mixed, "suggestions", "hidden");
mixed = setNavVisible(mixed, false);
check(mixed.panels["quick-note"].visibility === "minimised", "a minimised companion still wins");
check(mixed.panels["window-stack"].visibility === "minimised", "window stack can still be minimised");
check(mixed.panels.suggestions.visibility === "hidden", "suggestions can still be hidden");

const shown = sidebarMotion(true, true, false);
check(shown.visible === true && shown.handle === false && shown.gear === false, "visible sidebar has no handle and no gear");
check(shown.transition === `transform ${SIDEBAR_SLIDE_MS}ms ease`, "visible sidebar can slide");

const hiding = sidebarMotion(false, true, false);
check(hiding.visible === false && hiding.handle === true, "hiding shows the handle");
check(hiding.transition === shown.transition, "hiding uses the same reversible transform");

const snappedOff = sidebarMotion(false, false, false);
check(snappedOff.transition === "none" && snappedOff.handle === true, "animations off skips the slide");
const reduced = sidebarMotion(false, true, true);
check(reduced.transition === "none" && reduced.handle === true, "reduced motion skips the slide");

const back = sidebarMotion(true, true, false);
check(back.visible === true && back.handle === false, "restore removes the handle");
check(back.transition === `transform ${SIDEBAR_SLIDE_MS}ms ease`, "restore can slide back");

check(sidebarEdge(100, 1000) === "left", "left half slides left");
check(sidebarEdge(499, 1000) === "left", "just left of center slides left");
check(sidebarEdge(500, 1000) === "right", "center and the right half slide right");
check(sidebarEdge(900, 200) === "right", "right half slides right");
check(sidebarOffscreenX("left", 28, 180, 1440) === -(28 + 180), "left slide clears the screen edge");
check(sidebarOffscreenX("right", 900, 180, 1440) === 1440 - 900, "right slide clears the screen edge");

console.log("nav visibility tests passed");
