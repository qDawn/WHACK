import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  clamp,
  magnetic,
  MIN_NOTE_HEIGHT,
  MIN_NOTE_WIDTH,
  settle,
  type FrameBox,
} from "../layout/geometry";
import type { Visibility } from "../layout/types";

type DragSession = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
  fromPill: boolean;
};

type ResizeSession = {
  pointerId: number;
  startX: number;
  startY: number;
  originWidth: number;
  originHeight: number;
  anchor: "bottom-left" | "free";
};

type PanelFrameProps = {
  id: string;
  label: string;
  editMode: boolean;
  selected: boolean;
  visibility: Visibility;
  snap: boolean;
  zIndex: number;
  inset: number;
  stageWidth: number;
  stageHeight: number;
  box: FrameBox;
  resizable?: boolean;
  resizeWidth?: number;
  resizeHeight?: number;
  canRestore?: boolean;
  restoreHint?: string;
  open?: boolean;
  onSelect: () => void;
  onRaise: () => void;
  onMove: (xPx: number, yPx: number) => void;
  onResize?: (widthPx: number, heightPx: number) => void;
  onResizeStart?: () => void;
  onMinimise: () => void;
  onHide: () => void;
  onRestore: () => void;
  children: ReactNode;
};

function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("button, textarea, input, a, select, label, [data-no-drag]"));
}

function onScrollbar(event: ReactPointerEvent<HTMLDivElement>): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const scroller = target.closest(".suggestions, .window-stack");
  if (!(scroller instanceof HTMLElement)) return false;
  if (scroller.scrollHeight <= scroller.clientHeight + 1) return false;
  const rect = scroller.getBoundingClientRect();
  return event.clientX >= rect.right - 16;
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.2 2.8h3.6l.5 2.1c.6.2 1.2.5 1.7.9l2-.9 2.5 2.5-.9 2c.4.5.7 1.1.9 1.7l2.1.5v3.6l-2.1.5c-.2.6-.5 1.2-.9 1.7l.9 2-2.5 2.5-2-.9c-.5.4-1.1.7-1.7.9l-.5 2.1h-3.6l-.5-2.1a7 7 0 0 1-1.7-.9l-2 .9-2.5-2.5.9-2a7 7 0 0 1-.9-1.7l-2.1-.5V9.6l2.1-.5c.2-.6.5-1.2.9-1.7l-.9-2 2.5-2.5 2 .9c.5-.4 1.1-.7 1.7-.9l.5-2.1z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

export default function PanelFrame({
  id,
  label,
  editMode,
  selected,
  visibility,
  snap,
  zIndex,
  inset,
  stageWidth,
  stageHeight,
  box,
  resizable = false,
  resizeWidth,
  resizeHeight,
  canRestore = true,
  restoreHint,
  open,
  onSelect,
  onRaise,
  onMove,
  onResize,
  onResizeStart,
  onMinimise,
  onHide,
  onRestore,
  children,
}: PanelFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const resizeRef = useRef<ResizeSession | null>(null);
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuBox, setMenuBox] = useState<{ top: number; left: number } | null>(null);
  const showSettings = hover || menuOpen || (editMode && selected);
  const anchor = box.anchor;

  useEffect(() => {
    setMenuOpen(false);
  }, [visibility]);

  useEffect(() => {
    if (editMode) return;
    dragRef.current = null;
    resizeRef.current = null;
    setDragging(false);
  }, [editMode]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (gearRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".panel-menu")) return;
      setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  function emitMove(session: DragSession, dx: number, dy: number, commit: boolean) {
    const snapTo = commit ? settle : magnetic;
    const x = snapTo(session.originX + dx, snap);
    const y = snapTo(session.originY + dy, snap);
    const maxX = Math.max(0, stageWidth - 48);
    const maxY = Math.max(0, stageHeight - 48);
    onMove(clamp(x, 0, maxX), clamp(y, 0, maxY));
  }

  function emitResize(session: ResizeSession, dx: number, dy: number, commit: boolean) {
    const snapTo = commit ? settle : magnetic;
    const rawWidth = session.originWidth + dx;
    const rawHeight = session.anchor === "bottom-left" ? session.originHeight - dy : session.originHeight + dy;
    const width = clamp(snapTo(rawWidth, snap), Math.min(MIN_NOTE_WIDTH, stageWidth), Math.max(stageWidth, 1));
    const height = clamp(snapTo(rawHeight, snap), Math.min(MIN_NOTE_HEIGHT, stageHeight), Math.max(stageHeight, 1));
    onResize?.(width, height);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if (isInteractive(event.target) || onScrollbar(event)) return;
    const fromPill = event.target instanceof Element && Boolean(event.target.closest(".panel-pill"));
    if (!editMode && !fromPill) return;
    const frame = frameRef.current;
    if (!frame) return;
    event.preventDefault();
    frame.setPointerCapture(event.pointerId);
    if (editMode) onSelect();
    setDragging(editMode);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: frame.offsetLeft - inset,
      originY: frame.offsetTop - inset,
      moved: false,
      fromPill,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId || !editMode) return;
    const dx = event.clientX - session.startX;
    const dy = event.clientY - session.startY;
    if (!session.moved && Math.hypot(dx, dy) < 3) return;
    session.moved = true;
    emitMove(session, dx, dy, false);
  }

  function endPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (session.moved) emitMove(session, event.clientX - session.startX, event.clientY - session.startY, true);
    const restorePill = !session.moved && session.fromPill && canRestore;
    dragRef.current = null;
    setDragging(false);
    if (restorePill) onRestore();
  }

  function startResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!editMode || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const frame = frameRef.current;
    if (!frame) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect();
    onResizeStart?.();
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originWidth: resizeWidth ?? frame.offsetWidth,
      originHeight: resizeHeight ?? frame.offsetHeight,
      anchor,
    };
  }

  function moveResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const session = resizeRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    emitResize(session, event.clientX - session.startX, event.clientY - session.startY, false);
  }

  function endResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const session = resizeRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    emitResize(session, event.clientX - session.startX, event.clientY - session.startY, true);
    resizeRef.current = null;
  }

  function toggleGear() {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const menuHeight = 96;
    const menuWidth = 176;
    let top = rect.bottom + 8;
    if (top + menuHeight > window.innerHeight - 8) {
      const above = rect.top - menuHeight - 8;
      top = above >= 8 ? above : 8;
    }
    const maxLeft = Math.max(8, window.innerWidth - menuWidth - 8);
    const left = Math.min(Math.max(8, rect.right - menuWidth), maxLeft);
    setMenuBox({ top, left });
    setMenuOpen(true);
    onRaise();
  }

  const style: CSSProperties = { left: box.left, zIndex };
  if (anchor === "bottom-left") style.bottom = box.bottom ?? inset;
  else style.top = box.top;
  if (visibility !== "minimised") {
    if (box.width !== undefined) style.width = box.width;
    if (box.height !== undefined) style.height = box.height;
  }

  const menu =
    menuOpen && menuBox
      ? createPortal(
          <div className="panel-menu glass-panel" style={{ top: menuBox.top, left: menuBox.left }} role="menu" aria-label={`${label} settings`}>
            {visibility === "visible" ? (
              <button
                type="button"
                className="glass-menu__item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onMinimise();
                }}
              >
                Minimise
              </button>
            ) : null}
            <button
              type="button"
              className="glass-menu__item"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onHide();
              }}
            >
              Hide
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      ref={frameRef}
      className="panel-frame"
      style={style}
      data-panel={id}
      data-selected={selected ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      data-minimised={visibility === "minimised" ? "true" : "false"}
      data-anchor={anchor}
      data-open={open === undefined ? undefined : open ? "true" : "false"}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
    >
      {visibility === "minimised" ? (
        <div
          className="panel-pill glass-panel float-panel"
          role="button"
          tabIndex={0}
          aria-label={canRestore ? `Restore ${label}` : restoreHint || label}
          title={canRestore ? `Restore ${label}` : restoreHint}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            if (canRestore) onRestore();
          }}
        >
          <span className="panel-pill__label">{label}</span>
        </div>
      ) : (
        children
      )}
      {editMode && visibility === "visible" ? (
        <>
          <div className="panel-frame__grip panel-frame__grip--top" aria-hidden="true" />
          <div className="panel-frame__grip panel-frame__grip--right" aria-hidden="true" />
          <div className="panel-frame__grip panel-frame__grip--bottom" aria-hidden="true" />
          <div className="panel-frame__grip panel-frame__grip--left" aria-hidden="true" />
        </>
      ) : null}
      {resizable && editMode && visibility === "visible" ? (
        <button
          type="button"
          className={anchor === "bottom-left" ? "panel-frame__resize panel-frame__resize--top" : "panel-frame__resize"}
          data-no-drag
          aria-label="Resize note"
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        />
      ) : null}
      {showSettings ? (
        <div className="panel-frame__settings">
          <button
            ref={gearRef}
            type="button"
            className="panel-frame__gear"
            data-no-drag
            aria-label={`${label} settings`}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={toggleGear}
          >
            <GearIcon />
          </button>
        </div>
      ) : null}
      {menu}
    </div>
  );
}
