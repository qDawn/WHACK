export const NAV_CONTROLS = [
  { id: "sidebar", label: "Sidebar visibility" },
  { id: "edit", label: "Edit" },
  { id: "settings", label: "Settings" },
] as const;

export type NavControl = (typeof NAV_CONTROLS)[number];

/** Sidebar, Edit, and Settings. Shortcut picking is a widget, not a nav control. */
export function navControls(): readonly NavControl[] {
  return NAV_CONTROLS;
}
