import { Fragment, forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { navControls, type NavControl } from "../layout/navModel";

type NavBarProps = {
  editMode: boolean;
  snap: boolean;
  animations: boolean;
  layoutError: string | null;
  onToggleEdit: () => void;
  onToggleSnap: () => void;
  onToggleAnimations: () => void;
  onReset: () => void;
  sidebarVisible: boolean;
  onSidebarVisible: (visible: boolean) => void;
  onOpenModelDiagnostics: () => void;
};

type PopoverBox = {
  top?: number;
  bottom?: number;
  left: number;
};

export type NavBarHandle = {
  /** Closes Settings. True when it was open. */
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

function popoverBox(anchor: HTMLElement, height: number): PopoverBox {
  const rect = anchor.getBoundingClientRect();
  const above = rect.top > window.innerHeight * 0.55;
  const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - 248));
  if (above) return { bottom: window.innerHeight - rect.top + 8, left };
  const top = Math.min(rect.bottom + 8, Math.max(8, window.innerHeight - height - 8));
  return { top, left };
}

const NavBar = forwardRef<NavBarHandle, NavBarProps>(function NavBar(
  { editMode, snap, animations, layoutError, onToggleEdit, onToggleSnap, onToggleAnimations, onReset, sidebarVisible, onSidebarVisible, onOpenModelDiagnostics },
  ref,
) {
  const rootRef = useRef<HTMLElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsBox, setSettingsBox] = useState<PopoverBox | null>(null);
  const controls = navControls();

  useImperativeHandle(
    ref,
    () => ({
      closePopovers: () => {
        if (!settingsOpen) return false;
        setSettingsOpen(false);
        return true;
      },
    }),
    [settingsOpen],
  );

  useEffect(() => {
    if (sidebarVisible) return;
    setSettingsOpen(false);
  }, [sidebarVisible]);

  useEffect(() => {
    if (!settingsOpen) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".nav-popover")) return;
      setSettingsOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [settingsOpen]);

  function toggleSettings() {
    if (settingsOpen) {
      setSettingsOpen(false);
      return;
    }
    if (settingsRef.current) setSettingsBox(popoverBox(settingsRef.current, 272));
    setSettingsOpen(true);
  }

  function toggleSidebar() {
    if (sidebarVisible) setSettingsOpen(false);
    onSidebarVisible(!sidebarVisible);
  }

  function renderControl(control: NavControl): ReactNode {
    if (control.id === "sidebar") {
      return (
        <button
          type="button"
          className="nav-bar__switch"
          data-nav="sidebar"
          data-no-drag
          role="switch"
          aria-checked={sidebarVisible}
          aria-label={control.label}
          title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={toggleSidebar}
        >
          <span className="nav-bar__switch-thumb" aria-hidden="true" />
        </button>
      );
    }
    if (control.id === "edit") {
      return (
        <button
          type="button"
          className="nav-bar__button"
          data-nav="edit"
          aria-label={control.label}
          aria-pressed={editMode}
          title={control.label}
          onClick={onToggleEdit}
        >
          <NavIcon>
            <path d="M14.1 4.9a1.8 1.8 0 0 1 2.5 0l2.5 2.5a1.8 1.8 0 0 1 0 2.5L8.8 20.2 4 21l.8-4.8L14.1 4.9z" />
            <path d="M12.4 6.6l5 5" />
          </NavIcon>
          <span className="nav-bar__tooltip" aria-hidden="true">
            {control.label}
          </span>
        </button>
      );
    }
    return (
      <button
        ref={settingsRef}
        type="button"
        className="nav-bar__button"
        data-nav="settings"
        aria-label={control.label}
        aria-expanded={settingsOpen}
        title={control.label}
        onClick={toggleSettings}
      >
        <NavIcon>
          <path d="M10.2 2.8h3.6l.5 2.1c.6.2 1.2.5 1.7.9l2-.9 2.5 2.5-.9 2c.4.5.7 1.1.9 1.7l2.1.5v3.6l-2.1.5c-.2.6-.5 1.2-.9 1.7l.9 2-2.5 2.5-2-.9c-.5.4-1.1.7-1.7.9l-.5 2.1h-3.6l-.5-2.1a7 7 0 0 1-1.7-.9l-2 .9-2.5-2.5.9-2a7 7 0 0 1-.9-1.7l-2.1-.5V9.6l2.1-.5c.2-.6.5-1.2.9-1.7l-.9-2 2.5-2.5 2 .9c.5-.4 1.1-.7 1.7-.9l.5-2.1z" />
          <circle cx="12" cy="12" r="2.5" />
        </NavIcon>
        <span className="nav-bar__tooltip" aria-hidden="true">
          {control.label}
        </span>
      </button>
    );
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
            <button
              type="button"
              className="glass-menu__item"
              onClick={() => {
                setSettingsOpen(false);
                onOpenModelDiagnostics();
              }}
            >
              Model diagnostics
            </button>
            {layoutError ? <p className="nav-popover__error">{layoutError}</p> : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <nav ref={rootRef} className="nav-bar glass-panel float-panel" data-region="nav" aria-label="Aura">
      {controls.map((control) => (
        <Fragment key={control.id}>
          {control.id === "edit" ? <span className="nav-bar__divider" aria-hidden="true" /> : null}
          {renderControl(control)}
        </Fragment>
      ))}
      {settingsMenu}
    </nav>
  );
});

export default NavBar;
