import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CatalogStatus } from "../layout/useDashboardLayout";
import type { CatalogEntry } from "../layout/types";
import type { SuggestionError } from "./Suggestions";

type Shortcut = {
  id: string;
  title: string;
};

type NavBarProps = {
  editMode: boolean;
  snap: boolean;
  animations: boolean;
  shortcuts: Shortcut[];
  catalog: CatalogEntry[];
  catalogStatus: CatalogStatus;
  catalogError: string | null;
  error: SuggestionError | null;
  layoutError: string | null;
  onToggleEdit: () => void;
  onToggleSnap: () => void;
  onToggleAnimations: () => void;
  onReset: () => void;
  onPin: (id: string) => void;
  onActivate: (id: string) => void;
  onRemove: (id: string) => void;
  onReorder: (sourceId: string, targetId: string) => void;
};

type PopoverBox = {
  top?: number;
  bottom?: number;
  left: number;
};

export type NavBarHandle = {
  /** Closes Settings or the shortcut picker. True when one of them was open. */
  closePopovers: () => boolean;
};

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function initial(title: string): string {
  const first = Array.from(title.trim())[0];
  return first ? first.toLocaleUpperCase() : "•";
}

function popoverBox(anchor: HTMLElement, height: number): PopoverBox {
  const rect = anchor.getBoundingClientRect();
  const above = rect.top > window.innerHeight * 0.55;
  const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - 248));
  if (above) return { bottom: window.innerHeight - rect.top + 8, left };
  const top = Math.min(rect.bottom + 8, Math.max(8, window.innerHeight - height - 8));
  return { top, left };
}

const NavBar = forwardRef<NavBarHandle, NavBarProps>(function NavBar(
  {
    editMode,
    snap,
    animations,
    shortcuts,
    catalog,
    catalogStatus,
    catalogError,
    error,
    layoutError,
    onToggleEdit,
    onToggleSnap,
    onToggleAnimations,
    onReset,
    onPin,
    onActivate,
    onRemove,
    onReorder,
  },
  ref,
) {
  const rootRef = useRef<HTMLElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLButtonElement>(null);
  const reorderRef = useRef<{ id: string; startX: number; moved: boolean } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsBox, setSettingsBox] = useState<PopoverBox | null>(null);
  const [pickerBox, setPickerBox] = useState<PopoverBox | null>(null);
  const pinned = new Set(shortcuts.map((entry) => entry.id));

  useImperativeHandle(
    ref,
    () => ({
      closePopovers: () => {
        if (!settingsOpen && !pickerOpen) return false;
        setSettingsOpen(false);
        setPickerOpen(false);
        return true;
      },
    }),
    [settingsOpen, pickerOpen],
  );

  useEffect(() => {
    if (!settingsOpen && !pickerOpen) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".nav-popover")) return;
      setSettingsOpen(false);
      setPickerOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [settingsOpen, pickerOpen]);

  function toggleSettings() {
    setPickerOpen(false);
    if (settingsOpen) {
      setSettingsOpen(false);
      return;
    }
    if (settingsRef.current) setSettingsBox(popoverBox(settingsRef.current, 228));
    setSettingsOpen(true);
  }

  function togglePicker() {
    setSettingsOpen(false);
    if (pickerOpen) {
      setPickerOpen(false);
      return;
    }
    if (pickerRef.current) setPickerBox(popoverBox(pickerRef.current, 360));
    setPickerOpen(true);
  }

  function startReorder(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    if (!editMode || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    reorderRef.current = { id, startX: event.clientX, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveReorder(event: ReactPointerEvent<HTMLButtonElement>) {
    const session = reorderRef.current;
    if (!session || !editMode) return;
    if (!session.moved && Math.abs(event.clientX - session.startX) < 4) return;
    session.moved = true;
    const row = event.currentTarget.closest("[data-shortcut-row]");
    if (!row) return;
    const items = Array.from(row.querySelectorAll<HTMLElement>("[data-shortcut-id]"));
    let closestId = session.id;
    let best = Number.POSITIVE_INFINITY;
    for (const item of items) {
      const id = item.dataset.shortcutId;
      if (!id) continue;
      const rect = item.getBoundingClientRect();
      const distance = Math.abs(event.clientX - (rect.left + rect.width / 2));
      if (distance < best) {
        best = distance;
        closestId = id;
      }
    }
    if (closestId !== session.id) onReorder(session.id, closestId);
  }

  function endReorder(event: ReactPointerEvent<HTMLButtonElement>) {
    if (reorderRef.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    reorderRef.current = null;
  }

  const settingsMenu =
    settingsOpen && settingsBox
      ? createPortal(
          <div className="nav-popover glass-panel" style={settingsBox} role="dialog" aria-label="Settings">
            <p className="kicker">Dashboard</p>
            <button type="button" className="glass-menu__item" aria-pressed={snap} onClick={onToggleSnap}>
              <span>Snap to grid</span>
              <span>{snap ? "On" : "Off"}</span>
            </button>
            <button type="button" className="glass-menu__item" aria-pressed={animations} onClick={onToggleAnimations}>
              <span>Animations</span>
              <span>{animations ? "On" : "Off"}</span>
            </button>
            <button
              type="button"
              className="glass-menu__item"
              onClick={() => {
                onReset();
                setSettingsOpen(false);
              }}
            >
              Reset dashboard
            </button>
            {layoutError ? <p className="nav-popover__error">{layoutError}</p> : null}
          </div>,
          document.body,
        )
      : null;

  const pickerMenu =
    pickerOpen && pickerBox
      ? createPortal(
          <div className="nav-popover nav-popover--catalog glass-panel" style={pickerBox} role="dialog" aria-label="Shortcut picker">
            <p className="kicker">Shortcuts</p>
            {catalogStatus === "loading" ? <p className="nav-popover__status">Loading catalog...</p> : null}
            {catalogStatus === "unavailable" ? (
              <p className="nav-popover__status">Shortcuts load in the Aura window.</p>
            ) : null}
            {catalogStatus === "error" ? <p className="nav-popover__error">{catalogError || "Could not read the catalog."}</p> : null}
            {catalogStatus === "ready" && catalog.length === 0 ? (
              <p className="nav-popover__status">No apps in the catalog.</p>
            ) : null}
            {catalogStatus === "ready"
              ? catalog.map((entry) => {
                  const already = pinned.has(entry.id);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className="glass-menu__item nav-popover__choice"
                      aria-pressed={already}
                      onClick={() => {
                        if (!already) onPin(entry.id);
                      }}
                    >
                      <span className="nav-popover__choice-text">
                        <span>{entry.title}</span>
                        <span className="nav-popover__kind">{entry.id}</span>
                      </span>
                      {already ? <span className="nav-popover__kind">Pinned</span> : null}
                    </button>
                  );
                })
              : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <nav ref={rootRef} className="nav-bar glass-panel float-panel" data-region="nav" aria-label="Aura">
      <button
        type="button"
        className="nav-bar__button"
        data-nav="edit"
        aria-label="Edit"
        aria-pressed={editMode}
        title="Edit"
        onClick={onToggleEdit}
      >
        <NavIcon>
          <path d="M14.1 4.9a1.8 1.8 0 0 1 2.5 0l2.5 2.5a1.8 1.8 0 0 1 0 2.5L8.8 20.2 4 21l.8-4.8L14.1 4.9z" />
          <path d="M12.4 6.6l5 5" />
        </NavIcon>
        <span className="nav-bar__tooltip" aria-hidden="true">
          Edit
        </span>
      </button>
      <button
        ref={settingsRef}
        type="button"
        className="nav-bar__button"
        data-nav="settings"
        aria-label="Settings"
        aria-expanded={settingsOpen}
        title="Settings"
        onClick={toggleSettings}
      >
        <NavIcon>
          <path d="M10.2 2.8h3.6l.5 2.1c.6.2 1.2.5 1.7.9l2-.9 2.5 2.5-.9 2c.4.5.7 1.1.9 1.7l2.1.5v3.6l-2.1.5c-.2.6-.5 1.2-.9 1.7l.9 2-2.5 2.5-2-.9c-.5.4-1.1.7-1.7.9l-.5 2.1h-3.6l-.5-2.1a7 7 0 0 1-1.7-.9l-2 .9-2.5-2.5.9-2a7 7 0 0 1-.9-1.7l-2.1-.5V9.6l2.1-.5c.2-.6.5-1.2.9-1.7l-.9-2 2.5-2.5 2 .9c.5-.4 1.1-.7 1.7-.9l.5-2.1z" />
          <circle cx="12" cy="12" r="2.5" />
        </NavIcon>
        <span className="nav-bar__tooltip" aria-hidden="true">
          Settings
        </span>
      </button>
      <button
        ref={pickerRef}
        type="button"
        className="nav-bar__button"
        data-nav="shortcut-picker"
        aria-label="Shortcut picker"
        aria-expanded={pickerOpen}
        title="Shortcut picker"
        onClick={togglePicker}
      >
        <NavIcon>
          <rect x="4" y="4" width="16" height="16" rx="3.5" />
          <path d="M12 8.5v7M8.5 12h7" />
        </NavIcon>
        <span className="nav-bar__tooltip" aria-hidden="true">
          Shortcut picker
        </span>
      </button>
      {shortcuts.length > 0 ? <span className="nav-bar__divider" aria-hidden="true" /> : null}
      {shortcuts.length > 0 ? (
        <div className="nav-bar__shortcuts" data-shortcut-row>
          {shortcuts.map((entry) => {
            const shortcutError = error?.kind === entry.id ? error.message : null;
            return (
              <span key={entry.id} className="nav-bar__shortcut" data-shortcut-id={entry.id}>
                <button
                  type="button"
                  className="nav-bar__button"
                  data-nav="shortcut"
                  data-kind={entry.id}
                  data-error={shortcutError ? "true" : "false"}
                  aria-label={editMode ? `Reorder ${entry.title}` : entry.title}
                  title={shortcutError ?? entry.title}
                  onClick={() => {
                    if (!editMode) onActivate(entry.id);
                  }}
                  onPointerDown={(event) => startReorder(event, entry.id)}
                  onPointerMove={moveReorder}
                  onPointerUp={endReorder}
                  onPointerCancel={endReorder}
                >
                  <span className="nav-bar__initial" aria-hidden="true">
                    {initial(entry.title)}
                  </span>
                  <span className="nav-bar__tooltip" aria-hidden="true">
                    {shortcutError ?? entry.title}
                  </span>
                </button>
                {editMode ? (
                  <button
                    type="button"
                    className="nav-bar__remove"
                    data-no-drag
                    aria-label={`Remove ${entry.title}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => onRemove(entry.id)}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            );
          })}
        </div>
      ) : null}
      {settingsMenu}
      {pickerMenu}
    </nav>
  );
});

export default NavBar;
