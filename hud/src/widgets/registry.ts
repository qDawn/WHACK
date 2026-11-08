import type { ComponentType } from "react";
import ShortcutWidget, { ShortcutPreview } from "./ShortcutWidget";
import { SHORTCUT_VARIANTS, SHORTCUT_WIDGET_TYPE } from "./shortcuts";

export type WidgetSizeVariant = {
  id: string;
  width: number;
  height: number;
};

/**
 * One registration is one first-party widget.
 * `sizes` are fixed CSS pixel boxes. The quick note is the only freely resizable piece.
 * The library lists every registration. `allowMultiple` can place another instance.
 * Without it, one instance can be placed; the row stays visible and does not place a second copy.
 * Widgets use Remove in edit mode. They do not offer Hide or Minimise.
 */
export type WidgetRegistration = {
  type: string;
  title: string;
  description: string;
  sizes: readonly WidgetSizeVariant[];
  /** When true, the library can place another instance after one exists. */
  allowMultiple?: boolean;
  Preview: ComponentType;
  Widget: ComponentType<{ instanceId: string }>;
};

export const widgetRegistry: readonly WidgetRegistration[] = [
  {
    type: SHORTCUT_WIDGET_TYPE,
    title: "Shortcuts",
    description: "A fixed grid of apps you choose. Add more than one, each with its own list.",
    allowMultiple: true,
    sizes: SHORTCUT_VARIANTS.map(({ id, width, height }) => ({ id, width, height })),
    Preview: ShortcutPreview,
    Widget: ShortcutWidget,
  },
];

export function widgetByType(type: string): WidgetRegistration | undefined {
  return widgetRegistry.find((entry) => entry.type === type);
}
