import { createContext, useContext, type ReactNode } from "react";
import type { CatalogEntry, CatalogStatus, LayoutDocument } from "../layout/types";
import { shortcutRecord, type ShortcutAction, type WidgetStateDocument } from "./shortcuts";

export type WidgetRuntime = {
  editMode: boolean;
  actions: readonly ShortcutAction[];
  catalog: readonly CatalogEntry[];
  catalogStatus: CatalogStatus;
  catalogError: string | null;
  error: { message: string; kind: string | null } | null;
  variantOf: (instanceId: string) => string;
  idsOf: (instanceId: string) => readonly string[];
  setVariant: (instanceId: string, variant: string) => void;
  addShortcut: (instanceId: string, id: string) => void;
  removeShortcut: (instanceId: string, id: string) => void;
  openKind: (kind: string) => void;
};

const WidgetRuntimeContext = createContext<WidgetRuntime | null>(null);

type WidgetRuntimeProviderProps = {
  editMode: boolean;
  actions: readonly ShortcutAction[];
  catalog: readonly CatalogEntry[];
  catalogStatus: CatalogStatus;
  catalogError: string | null;
  error: { message: string; kind: string | null } | null;
  layout: LayoutDocument | null;
  widgetState: WidgetStateDocument;
  setVariant: (instanceId: string, variant: string) => void;
  addShortcut: (instanceId: string, id: string) => void;
  removeShortcut: (instanceId: string, id: string) => void;
  onOpen: (kind: string) => void;
  children: ReactNode;
};

export function WidgetRuntimeProvider({
  editMode,
  actions,
  catalog,
  catalogStatus,
  catalogError,
  error,
  layout,
  widgetState,
  setVariant,
  addShortcut,
  removeShortcut,
  onOpen,
  children,
}: WidgetRuntimeProviderProps) {
  const value: WidgetRuntime = {
    editMode,
    actions,
    catalog,
    catalogStatus,
    catalogError,
    error,
    variantOf: (instanceId) => layout?.widgets.find((widget) => widget.id === instanceId)?.variant ?? "compact",
    idsOf: (instanceId) => {
      const variant = layout?.widgets.find((widget) => widget.id === instanceId)?.variant ?? "compact";
      return shortcutRecord(widgetState, instanceId, variant).shortcuts;
    },
    setVariant,
    addShortcut,
    removeShortcut,
    openKind: onOpen,
  };
  return <WidgetRuntimeContext.Provider value={value}>{children}</WidgetRuntimeContext.Provider>;
}

export function useWidgetRuntime(): WidgetRuntime | null {
  return useContext(WidgetRuntimeContext);
}
