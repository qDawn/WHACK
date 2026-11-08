import { useEffect, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { noteFrame, noteSize, panelFrame, STAGE_INSET } from "../layout/geometry";
import { PANEL_IDS, PANEL_LABELS } from "../layout/types";
import type { DashboardController } from "../layout/useDashboardLayout";
import { runningInTauri } from "../tauri";
import { widgetByType } from "../widgets/registry";
import NavBar, { type NavBarHandle } from "./NavBar";
import PanelFrame from "./PanelFrame";
import QuickNote from "./QuickNote";
import Suggestions, { type ActionCard, type SuggestionError, type SuggestionsHandle } from "./Suggestions";
import WidgetLibrary, { type HiddenPiece } from "./WidgetLibrary";
import WindowStack, { type WindowStackHandle } from "./WindowStack";
import Workspace from "./Workspace";

type DashboardStageProps = {
  dashboard: DashboardController;
  actions: ActionCard[];
  suggestedKind: string | null;
  reason: string | null;
  error: SuggestionError | null;
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
  const [keyRegion, setKeyRegion] = useState<KeyRegion | null>(null);
  const libraryOpenRef = useRef(false);
  const keyRegionRef = useRef<KeyRegion | null>(null);
  const navRef = useRef<NavBarHandle>(null);
  const windowsRef = useRef<WindowStackHandle>(null);
  const suggestionsRef = useRef<SuggestionsHandle>(null);
  libraryOpenRef.current = libraryOpen;
  keyRegionRef.current = keyRegion;
  const { layout, stage, editMode, selectedId } = dashboard;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const typing = isTypingTarget(event.target);
      if (event.key === "Escape") {
        if (event.repeat) return;
        event.preventDefault();
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

      if (event.key === "ArrowLeft") {
        if (!windows || windows.count() === 0) return;
        event.preventDefault();
        suggestions?.setKeyboardHold(false);
        windows.setKeyboardHold(true);
        windows.focusSelection();
        keyRegionRef.current = "windows";
        setKeyRegion("windows");
        return;
      }
      if (event.key === "ArrowRight") {
        if (!suggestions || suggestions.count() === 0) return;
        event.preventDefault();
        windows?.setKeyboardHold(false);
        suggestions.setKeyboardHold(true);
        suggestions.focusSelection();
        keyRegionRef.current = "suggestions";
        setKeyRegion("suggestions");
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const region = keyRegionRef.current;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        if (region === "windows") {
          if (!windows || windows.count() === 0) return;
          event.preventDefault();
          windows.setKeyboardHold(true);
          windows.move(delta);
          return;
        }
        if (region === "suggestions") {
          if (!suggestions || suggestions.count() === 0) return;
          event.preventDefault();
          suggestions.setKeyboardHold(true);
          suggestions.move(delta);
        }
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

  const shortcuts =
    layout?.shortcuts.map((id) => ({
      id,
      title: dashboard.catalog.find((entry) => entry.id === id)?.title ?? id,
    })) ?? [];

  const hidden: HiddenPiece[] = [];
  if (layout) {
    for (const id of PANEL_IDS) {
      if (layout.panels[id].visibility === "hidden") hidden.push({ id, title: PANEL_LABELS[id] });
    }
    for (const widget of layout.widgets) {
      if (widget.visibility !== "hidden") continue;
      const registration = widgetByType(widget.type);
      if (!registration) continue;
      hidden.push({ id: widget.id, title: registration.title });
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

  return (
    <>
      <Workspace onAdd={() => setLibraryOpen(true)} />
      {layout && stage
        ? PANEL_IDS.map((id) => {
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
              id === "nav" ? (
                <NavBar
                  ref={navRef}
                  editMode={editMode}
                  snap={layout.snap}
                  animations={layout.animations}
                  shortcuts={shortcuts}
                  catalog={dashboard.catalog}
                  catalogStatus={dashboard.catalogStatus}
                  catalogError={dashboard.catalogError}
                  error={error}
                  layoutError={dashboard.layoutError}
                  onToggleEdit={dashboard.toggleEdit}
                  onToggleSnap={dashboard.toggleSnap}
                  onToggleAnimations={dashboard.toggleAnimations}
                  onReset={dashboard.reset}
                  onPin={dashboard.pin}
                  onActivate={onOpen}
                  onRemove={dashboard.unpin}
                  onReorder={dashboard.reorderShortcut}
                />
              ) : id === "window-stack" ? (
                <WindowStack ref={windowsRef} />
              ) : (
                <Suggestions
                  ref={suggestionsRef}
                  actions={actions}
                  suggestedKind={suggestedKind}
                  reason={reason}
                  error={error}
                  onOpen={onOpen}
                  onHoldChange={onHoldChange}
                  keyboardActive={keyRegion === "suggestions"}
                />
              );
            return (
              <PanelFrame key={id} id={id} label={PANEL_LABELS[id]} visibility={placement.visibility} zIndex={placement.z} box={box} {...bind(id)}>
                {child}
              </PanelFrame>
            );
          })
        : null}
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
                {...bind(instance.id)}
              >
                <div className="widget-host">
                  <Widget instanceId={instance.id} />
                </div>
              </PanelFrame>
            );
          })
        : null}
      {libraryOpen ? (
        <WidgetLibrary
          hidden={hidden}
          widgets={layout?.widgets ?? []}
          onAdd={dashboard.addWidget}
          onRestore={dashboard.restore}
          onClose={() => setLibraryOpen(false)}
        />
      ) : null}
    </>
  );
}
