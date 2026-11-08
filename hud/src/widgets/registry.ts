import type { ComponentType } from "react";

export type WidgetSizeVariant = {
  id: string;
  width: number;
  height: number;
};

/**
 * One registration is one first-party widget.
 * `sizes` are fixed CSS pixel boxes. The quick note is the only freely resizable piece.
 * The library places at most one instance of each `type`.
 */
export type WidgetRegistration = {
  type: string;
  title: string;
  description: string;
  sizes: readonly WidgetSizeVariant[];
  Preview: ComponentType;
  Widget: ComponentType<{ instanceId: string }>;
};

/** No widgets are registered yet. The library shows an empty state until one is added here. */
export const widgetRegistry: readonly WidgetRegistration[] = [];

export function widgetByType(type: string): WidgetRegistration | undefined {
  return widgetRegistry.find((entry) => entry.type === type);
}
