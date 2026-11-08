import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type RefObject } from "react";
import { runningInTauri } from "../tauri";
import { defaultLayout } from "./defaults";
import {
  applyPanelRemoval,
  bringToFront,
  noteCanBeVisible,
  parseLayout,
  pinShortcut,
  place,
  reorderShortcut,
  resizeNote as resizeNoteDocument,
  serializeLayout,
  setNavVisible as setNavVisibleDocument,
  setVisibility,
  setWidgetVariant,
  unpinShortcut,
} from "./document";
import { STAGE_INSET, type StageSize } from "./geometry";
import type { CatalogEntry, CatalogStatus, LayoutDocument } from "./types";
import { addWidgetInstance, applyWidgetRemoval, restoreWidgetInstance } from "../widgets/library";
import {
  addShortcutId,
  parseWidgetState,
  removeShortcutId,
  resetKeepsWidgetState,
  serializeWidgetState,
  shortcutRecord,
  withShortcutRecord,
  withVariant,
  type WidgetStateDocument,
} from "../widgets/shortcuts";

const SAVE_MS = 300;

export type { CatalogStatus };

export type DashboardController = {
  stageRef: RefObject<HTMLElement | null>;
  stage: StageSize | null;
  layout: LayoutDocument | null;
  /** Edit mode. Not stored in layout.json. Drag and resize read this flag. */
  editMode: boolean;
  selectedId: string | null;
  layoutError: string | null;
  catalog: CatalogEntry[];
  catalogStatus: CatalogStatus;
  catalogError: string | null;
  noteCanRestore: boolean;
  toggleEdit: () => void;
  toggleSnap: () => void;
  toggleAnimations: () => void;
  reset: () => void;
  select: (id: string) => void;
  raise: (id: string) => void;
  move: (id: string, xPx: number, yPx: number) => void;
  resizeNote: (widthPx: number, heightPx: number) => void;
  minimise: (id: string) => void;
  hide: (id: string) => void;
  restore: (id: string) => string | null;
  /** Sidebar visibility. Keeps x, y, z, and shortcut pins. */
  setNavVisible: (visible: boolean) => void;
  pin: (id: string) => void;
  unpin: (id: string) => void;
  reorderShortcut: (sourceId: string, targetId: string) => void;
  addWidget: (type: string, variant: string) => void;
  removeWidget: (id: string, choice: "keep" | "delete") => void;
  /** Hide a built-in panel. Keep leaves its place. Delete restores the default place. */
  removePanel: (id: string, choice: "keep" | "delete") => void;
  restoreWidget: (id: string) => void;
  widgetState: WidgetStateDocument;
  setShortcutVariant: (instanceId: string, variant: string) => void;
  addShortcut: (instanceId: string, id: string) => void;
  removeShortcut: (instanceId: string, id: string) => void;
};

function messageFrom(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function catalogEntries(value: unknown): CatalogEntry[] {
  if (!Array.isArray(value)) return [];
  const next: CatalogEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as { id?: unknown; title?: unknown };
    if (typeof record.id !== "string" || record.id.length === 0) continue;
    const title = typeof record.title === "string" && record.title.length > 0 ? record.title : record.id;
    next.push({ id: record.id, title });
  }
  return next;
}

export function useDashboardLayout(): DashboardController {
  const stageRef = useRef<HTMLElement | null>(null);
  const stageSize = useRef<StageSize | null>(null);
  const extrasRef = useRef<Record<string, unknown>>({});
  const loadedRef = useRef(false);
  const widgetRevision = useRef(0);
  const [stage, setStage] = useState<StageSize | null>(null);
  const [layout, setLayout] = useState<LayoutDocument | null>(null);
  const [ready, setReady] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>(runningInTauri() ? "loading" : "unavailable");
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [widgetState, setWidgetState] = useState<WidgetStateDocument>({});
  const [widgetReady, setWidgetReady] = useState(false);
  const stageReady = stage !== null && stage.width >= 8 && stage.height >= 8;

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const measure = () => {
      const next = {
        width: Math.max(0, element.clientWidth - STAGE_INSET * 2),
        height: Math.max(0, element.clientHeight - STAGE_INSET * 2),
      };
      stageSize.current = next;
      setStage((current) => (current && current.width === next.width && current.height === next.height ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!stageReady || loadedRef.current) return;
    let active = true;

    const applyDefaults = () => {
      const measured = stageSize.current;
      if (!measured) return;
      extrasRef.current = {};
      setLayout(defaultLayout(measured, window.innerWidth, window.innerHeight));
    };

    const finish = () => {
      if (!active) return;
      loadedRef.current = true;
      setReady(true);
    };

    if (!runningInTauri()) {
      applyDefaults();
      finish();
      setWidgetReady(true);
      return;
    }

    invoke<string>("read_layout")
      .then((text) => {
        if (!active) return;
        const parsed = parseLayout(text);
        if (parsed) {
          extrasRef.current = parsed.extras;
          setLayout(parsed.layout);
          return;
        }
        applyDefaults();
      })
      .catch((reason: unknown) => {
        if (!active) return;
        applyDefaults();
        setLayoutError(messageFrom(reason));
      })
      .finally(finish);

    invoke<string>("read_widget_state")
      .then((text) => {
        if (!active) return;
        const parsed = parseWidgetState(text);
        const edited = widgetRevision.current > 0;
        setWidgetState((current) => ({ ...(parsed ?? {}), ...current }));
        if (!parsed && !edited) return invoke("write_widget_state", { text: "{}\n" });
        return undefined;
      })
      .catch((reason: unknown) => {
        if (active) setLayoutError(messageFrom(reason));
      })
      .finally(() => {
        if (active) setWidgetReady(true);
      });

    invoke<unknown>("list_catalog")
      .then((value) => {
        if (!active) return;
        setCatalog(catalogEntries(value));
        setCatalogStatus("ready");
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setCatalogStatus("error");
        setCatalogError(messageFrom(reason));
      });

    return () => {
      active = false;
    };
  }, [stageReady]);

  useEffect(() => {
    if (!ready || !layout || !runningInTauri()) return;
    const text = serializeLayout(layout, extrasRef.current);
    const timer = window.setTimeout(() => {
      invoke("write_layout", { text })
        .then(() => setLayoutError(null))
        .catch((reason: unknown) => setLayoutError(messageFrom(reason)));
    }, SAVE_MS);
    return () => window.clearTimeout(timer);
  }, [layout, ready]);

  useEffect(() => {
    if (!widgetReady || !runningInTauri()) return;
    const text = serializeWidgetState(widgetState);
    const timer = window.setTimeout(() => {
      invoke("write_widget_state", { text }).catch((reason: unknown) => setLayoutError(messageFrom(reason)));
    }, SAVE_MS);
    return () => window.clearTimeout(timer);
  }, [widgetState, widgetReady]);

  function update(recipe: (current: LayoutDocument) => LayoutDocument) {
    setLayout((current) => (current ? recipe(current) : current));
  }

  function stageNow(): StageSize | null {
    const measured = stageSize.current;
    if (!measured || measured.width <= 0 || measured.height <= 0) return null;
    return measured;
  }

  function toggleEdit() {
    setSelectedId((current) => (editMode ? null : current));
    setEditMode((current) => !current);
  }

  function toggleSnap() {
    update((current) => ({ ...current, snap: !current.snap }));
  }

  function toggleAnimations() {
    update((current) => ({ ...current, animations: !current.animations }));
  }

  function changeWidgetState(recipe: (current: WidgetStateDocument) => WidgetStateDocument) {
    widgetRevision.current += 1;
    setWidgetState(recipe);
  }

  function reset() {
    const measured = stageNow();
    if (!measured || !layout) return;
    setSelectedId(null);
    const next = resetKeepsWidgetState(layout, measured, window.innerWidth, window.innerHeight, widgetState);
    setLayout(next.layout);
    setWidgetState(next.widgetState);
  }

  function raise(id: string) {
    update((current) => bringToFront(current, id));
  }

  function select(id: string) {
    setSelectedId(id);
    raise(id);
  }

  function move(id: string, xPx: number, yPx: number) {
    const measured = stageNow();
    if (!measured) return;
    update((current) => place(current, id, xPx, yPx, measured));
  }

  function resizeNote(widthPx: number, heightPx: number) {
    const measured = stageNow();
    if (!measured) return;
    update((current) => resizeNoteDocument(current, widthPx, heightPx, measured));
  }

  function minimise(id: string) {
    update((current) => setVisibility(current, id, "minimised"));
  }

  function hide(id: string) {
    setSelectedId((current) => (current === id ? null : current));
    update((current) => setVisibility(current, id, "hidden"));
  }

  function restore(id: string): string | null {
    if (!layout) return null;
    if (id === "nav") {
      update((current) => setNavVisibleDocument(current, true));
      return null;
    }
    if (id === "quick-note" && !noteCanBeVisible(layout)) {
      return "Restore another piece first. The quick note cannot be the only one showing.";
    }
    setLayout(bringToFront(setVisibility(layout, id, "visible"), id));
    return null;
  }

  function setNavVisible(visible: boolean) {
    if (!visible) setSelectedId((current) => (current === "nav" ? null : current));
    update((current) => setNavVisibleDocument(current, visible));
  }

  function pin(id: string) {
    update((current) => pinShortcut(current, id));
  }

  function unpin(id: string) {
    update((current) => unpinShortcut(current, id));
  }

  function reorder(sourceId: string, targetId: string) {
    update((current) => reorderShortcut(current, sourceId, targetId));
  }

  function addWidget(type: string, variant: string) {
    const measured = stageNow();
    if (!measured || !layout || (runningInTauri() && !widgetReady)) return;
    const next = addWidgetInstance(layout, widgetState, type, variant, measured);
    if (!next) return;
    if (next.layout !== layout) setLayout(next.layout);
    if (next.widgetState !== widgetState) changeWidgetState(() => next.widgetState);
  }

  function removePanel(id: string, choice: "keep" | "delete") {
    if (!layout) return;
    if (id !== "window-stack" && id !== "suggestions" && id !== "quick-note") return;
    const measured = stageNow();
    if (!measured) return;
    const next = applyPanelRemoval(layout, id, choice, defaultLayout(measured, window.innerWidth, window.innerHeight));
    if (next === layout) return;
    setSelectedId((current) => (current === id ? null : current));
    setLayout(next);
  }

  function removeWidget(id: string, choice: "keep" | "delete") {
    if (!layout) return;
    const next = applyWidgetRemoval(layout, widgetState, id, choice);
    if (next.layout === layout && next.widgetState === widgetState) return;
    setSelectedId((current) => (current === id ? null : current));
    if (next.layout !== layout) setLayout(next.layout);
    if (next.widgetState !== widgetState) changeWidgetState(() => next.widgetState);
  }

  function restoreWidget(id: string) {
    const measured = stageNow();
    if (!measured || !layout) return;
    const next = restoreWidgetInstance(layout, widgetState, id, measured);
    if (next.layout === layout) return;
    setLayout(next.layout);
  }

  function setShortcutVariant(instanceId: string, variant: string) {
    update((current) => setWidgetVariant(current, instanceId, variant));
    changeWidgetState((file) => {
      const record = shortcutRecord(file, instanceId, variant);
      const next = withVariant(record, variant);
      if (next === record && file[instanceId] !== undefined) return file;
      return withShortcutRecord(file, instanceId, next);
    });
  }

  function addShortcut(instanceId: string, id: string) {
    changeWidgetState((file) => {
      const variant = layout?.widgets.find((widget) => widget.id === instanceId)?.variant ?? "compact";
      const record = shortcutRecord(file, instanceId, variant);
      const next = addShortcutId(record, id);
      if (next === record) return file;
      return withShortcutRecord(file, instanceId, next);
    });
  }

  function removeShortcut(instanceId: string, id: string) {
    changeWidgetState((file) => {
      const variant = layout?.widgets.find((widget) => widget.id === instanceId)?.variant ?? "compact";
      const record = shortcutRecord(file, instanceId, variant);
      const next = removeShortcutId(record, id);
      if (next === record) return file;
      return withShortcutRecord(file, instanceId, next);
    });
  }

  return {
    stageRef,
    stage,
    layout,
    editMode,
    selectedId,
    layoutError,
    catalog,
    catalogStatus,
    catalogError,
    noteCanRestore: layout ? noteCanBeVisible(layout) : false,
    toggleEdit,
    toggleSnap,
    toggleAnimations,
    reset,
    select,
    raise,
    move,
    resizeNote,
    minimise,
    hide,
    restore,
    setNavVisible,
    pin,
    unpin,
    reorderShortcut: reorder,
    addWidget,
    removeWidget,
    removePanel,
    restoreWidget,
    widgetState,
    setShortcutVariant,
    addShortcut,
    removeShortcut,
  };
}
