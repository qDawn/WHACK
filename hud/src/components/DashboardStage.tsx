import { useEffect, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { noteFrame, noteSize, panelFrame, STAGE_INSET } from "../layout/geometry";
import { PANEL_IDS, PANEL_LABELS } from "../layout/types";
import type { DashboardController } from "../layout/useDashboardLayout";
import { runningInTauri } from "../tauri";
import { widgetByType } from "../widgets/registry";
import { WidgetRuntimeProvider } from "../widgets/runtime";
import type { ModelDiagnostics } from "../modelDiagnostics";
import ModelDiagnosticsPanel from "./ModelDiagnosticsPanel";
import NavBar, { type NavBarHandle } from "./NavBar";
import PanelFrame from "./PanelFrame";
import QuickNote from "./QuickNote";
import Suggestions, { type ActionCard, type SuggestionError, type SuggestionsHandle } from "./Suggestions";
import WidgetLibrary, { type HiddenPiece } from "./WidgetLibrary";
import WindowStack, { type WindowStackHandle } from "./WindowStack";

type DashboardStageProps = {
  dashboard: DashboardController;
  actions: ActionCard[];
  suggestedKind: string | null;
  reason: string | null;
  error: SuggestionError | null;
  modelStatus: string | null;
  diagnostics: ModelDiagnostics | null;
  onOpen: (kind: string) => void;
  onHoldChange: (held: boolean) => void;
  note: string;
  onNoteChange: (value: string) => void;
  noteOpen: boolean;
  onNoteOpenChange: (open: boolean) => void;
  noteError: string | null;
  noteRef: RefObject<HTMLTextAreaElement | null>;
};

const NOTE_HINT = "Restore another piece first. The quick note cannot be the only one showing.";

type RemovalKind = "widget" | "panel" | "note";

type PendingRemoval = {
  id: string;
  title: string;
  kind: RemovalKind;
};

function removalDetail(kind: RemovalKind): string {
  if (kind === "widget") {
    return "Keep configuration takes this widget off the stage and leaves its saved shortcuts. Delete configuration removes those shortcuts as well.";
  }
  if (kind === "note") {
    return "Keep configuration hides the note and leaves the text and its size. Delete configuration hides the note, clears the text, and restores the default size.";
  }
  return "Keep configuration hides this and remembers where you put it. Delete configuration hides it and restores its default place.";
}

type KeyRegion = "windows" | "suggestions";

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
}

export default function DashboardStage({
  dashboard,
  actions,
  suggestedKind,
  reason,
  error,
  modelStatus,
  diagnostics,
  onOpen,
  onHoldChange,
  note,
  onNoteChange,
  noteOpen,
  onNoteOpenChange,
  noteError,
  noteRef,
}: DashboardStageProps) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const [keyRegion, setKeyRegion] = useState<KeyRegion | null>(null);
  const libraryOpenRef = useRef(false);
  const diagnosticsOpenRef = useRef(false);
  const pendingRemovalRef = useRef<PendingRemoval | null>(null);
  const keyRegionRef = useRef<KeyRegion | null>(null);
  const navRef = useRef<NavBarHandle>(null);
  const windowsRef = useRef<WindowStackHandle>(null);
  const suggestionsRef = useRef<SuggestionsHandle>(null);
  libraryOpenRef.current = libraryOpen;
  diagnosticsOpenRef.current = diagnosticsOpen;
  pendingRemovalRef.current = pendingRemoval;
  keyRegionRef.current = keyRegion;
  const { layout, stage, editMode, selectedId } = dashboard;

  useEffect(() => {
    if (!editMode) setPendingRemoval(null);
  }, [editMode]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const typing = isTypingTarget(event.target);
      if (event.key === "Escape") {
        if (event.repeat) return;
        event.preventDefault();
        if (pendingRemovalRef.current) {
          setPendingRemoval(null);
          return;
        }
        if (diagnosticsOpenRef.current) {
          setDiagnosticsOpen(false);
          return;
        }
        if (libraryOpenRef.current) {
          setLibraryOpen(false);
          return;
        }
        if (navRef.current?.closePopovers()) return;
        if (runningInTauri()) void invoke("begin_dismiss");
        return;
      }
      if (typing || event.altKey || event.ctrlKey || event.metaKey) return;

      const windows = windowsRef.current;
      const suggestions = suggestionsRef.current;

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const region = keyRegionRef.current;
        if (region === "suggestions") {
          if (event.key !== "ArrowLeft") return;
          if (!windows || windows.count() === 0) return;
          event.preventDefault();
          suggestions?.setKeyboardHold(false);
          windows.setKeyboardHold(true);
          windows.focusSelection();
          keyRegionRef.current = "windows";
          setKeyRegion("windows");
          return;
        }
        if (!windows || windows.count() === 0) return;
        event.preventDefault();
        suggestions?.setKeyboardHold(false);
        windows.setKeyboardHold(true);
        windows.move(event.key === "ArrowRight" ? 1 : -1);
        keyRegionRef.current = "windows";
        setKeyRegion("windows");
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const region = keyRegionRef.current;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        if (region === "suggestions") {
          if (!suggestions || suggestions.count() === 0) return;
          event.preventDefault();
          suggestions.setKeyboardHold(true);
          suggestions.move(delta);
          return;
        }
        if (event.key === "ArrowDown") {
          if (!suggestions || suggestions.count() === 0) return;
          event.preventDefault();
          windows?.setKeyboardHold(false);
          suggestions.setKeyboardHold(true);
          suggestions.focusSelection();
          keyRegionRef.current = "suggestions";
          setKeyRegion("suggestions");
          return;
        }
        if (region === "windows") event.preventDefault();
        return;
      }
      if (event.key === "Enter" && !event.repeat) {
        const region = keyRegionRef.current;
        if (region === "windows") {
          if (!windows || windows.count() === 0) return;
          event.preventDefault();
          windows.activateSelected();
          return;
        }
        if (region === "suggestions") {
          if (!suggestions || suggestions.count() === 0) return;
          event.preventDefault();
          suggestions.activateSelected();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const hidden: HiddenPiece[] = [];
  if (layout) {
    for (const id of ["window-stack", "suggestions", "quick-note"] as const) {
      if (layout.panels[id].visibility === "hidden") hidden.push({ id, title: PANEL_LABELS[id] });
    }
  }

  function bind(id: string) {
    return {
      editMode,
      selected: selectedId === id,
      snap: layout?.snap ?? true,
      inset: STAGE_INSET,
      stageWidth: stage?.width ?? 0,
      stageHeight: stage?.height ?? 0,
      onSelect: () => dashboard.select(id),
      onRaise: () => dashboard.raise(id),
      onMove: (x: number, y: number) => dashboard.move(id, x, y),
      onMinimise: () => dashboard.minimise(id),
      onHide: () => dashboard.hide(id),
      onRestore: () => {
        dashboard.restore(id);
      },
    };
  }

  function askRemoval(id: string, title: string, kind: RemovalKind) {
    setPendingRemoval({ id, title, kind });
  }

  const pending = pendingRemoval;

  return (
    <>
      {layout && stage
        ? PANEL_IDS.map((id) => {
            if (id === "nav") {
              const nav = layout.panels.nav;
              return (
                <PanelFrame
                  key={id}
                  id={id}
                  label={PANEL_LABELS[id]}
                  visibility="visible"
                  zIndex={nav.z}
                  box={panelFrame(nav, stage)}
                  sidebar={{
                    visible: nav.visible,
                    animations: layout.animations,
                    onShow: () => dashboard.setNavVisible(true),
                  }}
                  {...bind(id)}
                >
                  <NavBar
                    ref={navRef}
                    editMode={editMode}
                    snap={layout.snap}
                    animations={layout.animations}
                    layoutError={dashboard.layoutError}
                    onToggleEdit={dashboard.toggleEdit}
                    onToggleSnap={dashboard.toggleSnap}
                    onToggleAnimations={dashboard.toggleAnimations}
                    onReset={dashboard.reset}
                    sidebarVisible={nav.visible}
                    onSidebarVisible={dashboard.setNavVisible}
                    onOpenModelDiagnostics={() => setDiagnosticsOpen(true)}
                    onAddWidget={() => setLibraryOpen(true)}
                  />
                </PanelFrame>
              );
            }
            const placement = layout.panels[id];
            if (placement.visibility === "hidden") return null;
            if (id === "quick-note") {
              const notePanel = layout.panels["quick-note"];
              const pixels = noteSize(notePanel, stage);
              const box = noteFrame(notePanel, stage, noteOpen);
              return (
                <PanelFrame
                  key={id}
                  id={id}
                  label={PANEL_LABELS[id]}
                  visibility={notePanel.visibility}
                  zIndex={notePanel.z}
                  box={box}
                  resizable
                  resizeWidth={pixels.width}
                  resizeHeight={pixels.height}
                  canRestore={dashboard.noteCanRestore}
                  restoreHint={NOTE_HINT}
                  open={noteOpen}
                  onResize={dashboard.resizeNote}
                  onResizeStart={() => onNoteOpenChange(true)}
                  onRemove={() => askRemoval(id, PANEL_LABELS[id], "note")}
                  {...bind(id)}
                >
                  <QuickNote
                    value={note}
                    onChange={onNoteChange}
                    open={noteOpen}
                    onOpenChange={onNoteOpenChange}
                    error={noteError}
                    inputRef={noteRef}
                  />
                </PanelFrame>
              );
            }
            const box = panelFrame(placement, stage);
            const child =
              id === "window-stack" ? (
                <WindowStack ref={windowsRef} />
              ) : (
                <Suggestions
                  ref={suggestionsRef}
                  actions={actions}
                  suggestedKind={suggestedKind}
                  reason={reason}
                  error={error}
                  modelStatus={modelStatus}
                  onOpen={onOpen}
                  onHoldChange={onHoldChange}
                  keyboardActive={keyRegion === "suggestions"}
                />
              );
            return (
              <PanelFrame
                key={id}
                id={id}
                label={PANEL_LABELS[id]}
                visibility={placement.visibility}
                zIndex={placement.z}
                box={box}
                onRemove={() => askRemoval(id, PANEL_LABELS[id], "panel")}
                {...bind(id)}
              >
                {child}
              </PanelFrame>
            );
          })
        : null}
      <WidgetRuntimeProvider
        editMode={editMode}
        actions={actions}
        catalog={dashboard.catalog}
        catalogStatus={dashboard.catalogStatus}
        catalogError={dashboard.catalogError}
        error={error}
        layout={layout}
        widgetState={dashboard.widgetState}
        setVariant={dashboard.setShortcutVariant}
        addShortcut={dashboard.addShortcut}
        removeShortcut={dashboard.removeShortcut}
        onOpen={onOpen}
      >
        {layout && stage
          ? layout.widgets.map((instance) => {
              if (instance.visibility === "hidden") return null;
              const registration = widgetByType(instance.type);
              if (!registration) return null;
              const size = registration.sizes.find((item) => item.id === instance.variant) ?? registration.sizes[0];
              if (!size) return null;
              const Widget = registration.Widget;
              const box = { ...panelFrame(instance, stage), width: size.width, height: size.height };
              return (
                <PanelFrame
                  key={instance.id}
                  id={instance.id}
                  label={registration.title}
                  visibility={instance.visibility}
                  zIndex={instance.z}
                  box={box}
                  showMenu={false}
                  widget
                  {...bind(instance.id)}
                  onRemove={() => askRemoval(instance.id, registration.title, "widget")}
                >
                  <div className="widget-host">
                    <Widget instanceId={instance.id} />
                  </div>
                </PanelFrame>
              );
            })
          : null}
      </WidgetRuntimeProvider>
      {diagnosticsOpen ? (
        <ModelDiagnosticsPanel diagnostics={diagnostics} onClose={() => setDiagnosticsOpen(false)} />
      ) : null}
      {libraryOpen ? (
        <WidgetLibrary
          hidden={hidden}
          widgets={layout?.widgets ?? []}
          widgetState={dashboard.widgetState}
          onAdd={dashboard.addWidget}
          onRestore={dashboard.restore}
          onRestoreWidget={dashboard.restoreWidget}
          onClose={() => setLibraryOpen(false)}
        />
      ) : null}
      {pending ? (
        <WidgetRemoveDialog
          title={pending.title}
          detail={removalDetail(pending.kind)}
          onKeep={() => {
            if (pending.kind === "widget") dashboard.removeWidget(pending.id, "keep");
            else dashboard.removePanel(pending.id, "keep");
            setPendingRemoval(null);
          }}
          onDelete={() => {
            if (pending.kind === "widget") dashboard.removeWidget(pending.id, "delete");
            else {
              dashboard.removePanel(pending.id, "delete");
              if (pending.kind === "note") onNoteChange("");
            }
            setPendingRemoval(null);
          }}
          onCancel={() => setPendingRemoval(null)}
        />
      ) : null}
    </>
  );
}

function WidgetRemoveDialog({
  title,
  detail,
  onKeep,
  onDelete,
  onCancel,
}: {
  title: string;
  detail: string;
  onKeep: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="widget-remove__backdrop" onPointerDown={onCancel}>
      <div
        className="widget-remove glass-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Remove ${title}`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 className="widget-remove__title">Remove {title}</h2>
        <p className="widget-remove__text">{detail}</p>
        <div className="widget-remove__actions">
          <button type="button" className="glass-menu__item" onClick={onKeep}>
            Keep configuration
          </button>
          <button type="button" className="glass-menu__item" onClick={onDelete}>
            Delete configuration
          </button>
          <button type="button" className="glass-menu__item" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
