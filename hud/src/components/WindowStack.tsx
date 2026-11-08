import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { runningInTauri } from "../tauri";
import {
  cardRole,
  commitSelection,
  selectedPreviewImage,
  selectionAfterHover,
  selectionAfterShrink,
  selectionFrame,
} from "../windows/stackMotion";
import {
  dirtyWindows,
  indexAfterPreviewLoad,
} from "../windows/previewFreshness";
import {
  indexAfterDrag,
  layoutStack,
  pointerResolution,
  type StackLayout,
} from "../windows/stackLayout";

type ListedWindow = {
  hwnd: string;
  processName: string;
  title: string;
};

type WindowList = {
  windows: ListedWindow[];
  foregroundHwnd: string | null;
};

type WindowPreview = {
  image: string | null;
  error: string | null;
  revision: number;
};

type PreviewUpdate = WindowPreview & {
  hwnd: string;
};

type Phase = "reading" | "ready" | "error";

export type WindowStackHandle = {
  count: () => number;
  focusSelection: () => void;
  move: (delta: number) => void;
  activateSelected: () => void;
  setKeyboardHold: (held: boolean) => void;
};

const POLL_MS = 1500;
const CLOSE_REFRESH_MS = 400;
const WHEEL_THRESHOLD = 80;
const DRAG_SLOP = 4;

function sameWindows(left: ListedWindow[], right: ListedWindow[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index].hwnd !== right[index].hwnd || left[index].title !== right[index].title) return false;
  }
  return true;
}

function messageFrom(reason: unknown): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message;
  if (typeof reason === "string" && reason.trim()) return reason;
  return "Could not read windows.";
}

/** Extra lead so a centred row can scroll back to cards that sit left of the viewport. */
function scrollPad(layout: StackLayout, containerWidth: number): { pad: number; track: number } {
  if (!layout.scroll || layout.cards.length === 0 || containerWidth <= 0) return { pad: 0, track: 0 };
  const width = layout.cards[0].width;
  const last = layout.cards.length - 1;
  const translateMin = containerWidth / 2 - (last * layout.step + width / 2);
  const pad = Math.max(0, -translateMin);
  const translateMax = containerWidth / 2 - width / 2;
  return { pad, track: layout.contentWidth + translateMax + pad };
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

const WindowStack = forwardRef<WindowStackHandle>(function WindowStack(props, ref) {
  void props;
  const inApp = runningInTauri();
  const sectionRef = useRef<HTMLElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const windowsRef = useRef<ListedWindow[]>([]);
  const indexRef = useRef(0);
  const selectedRef = useRef<string | null>(null);
  const holdRef = useRef(false);
  const pointerInsideRef = useRef(false);
  const focusInsideRef = useRef(false);
  const keyboardInsideRef = useRef(false);
  const pendingRef = useRef<ListedWindow[] | null>(null);
  const pendingForegroundRef = useRef<string | null>(null);
  const pendingGenRef = useRef(0);
  const snapshotRef = useRef<{ hwnd: string; title: string }[]>([]);
  const foregroundSeenRef = useRef<string | null>(null);
  const imagesRef = useRef<Record<string, string>>({});
  const previewErrorsRef = useRef<Record<string, string>>({});
  const revisionRef = useRef<Record<string, number>>({});
  const inflightRef = useRef<Set<string>>(new Set());
  const applyRef = useRef<(hwnd: string, result: WindowPreview) => void>(() => {});
  const appliedRef = useRef(0);
  const generationRef = useRef(0);
  const hasSuccessRef = useRef(false);
  const stepRef = useRef<(delta: number) => void>(() => {});
  const refreshRef = useRef<(force: boolean) => void>(() => {});
  const layoutStepRef = useRef(1);
  const suppressClickRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startIndex: number;
    cardIndex: number | null;
    scrubbed: boolean;
  } | null>(null);

  const [phase, setPhase] = useState<Phase>(inApp ? "reading" : "error");
  const [windows, setWindows] = useState<ListedWindow[]>([]);
  const [index, setIndex] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [stripSize, setStripSize] = useState({ width: 0, height: 0 });
  const [listError, setListError] = useState<string | null>(
    inApp ? null : "Window list is available in the Aura window.",
  );
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({});
  const [images, setImages] = useState<Record<string, string>>({});

  const frame = selectionFrame(windows, index);
  windowsRef.current = windows;
  indexRef.current = frame.index;
  selectedRef.current = frame.previewHwnd;
  imagesRef.current = images;
  previewErrorsRef.current = previewErrors;

  const layout = layoutStack({
    count: windows.length,
    selectedIndex: frame.index,
    containerWidth: stripSize.width,
    containerHeight: stripSize.height,
  });
  layoutStepRef.current = layout.step > 1 ? layout.step : 1;
  const scrolled = scrollPad(layout, stripSize.width);

  function applyPreview(hwnd: string, result: WindowPreview) {
    const kept = indexAfterPreviewLoad(indexRef.current, hwnd, selectedRef.current);
    if (kept !== indexRef.current) {
      indexRef.current = kept;
      selectedRef.current = windowsRef.current[kept]?.hwnd ?? null;
      setIndex(kept);
    }
    if (!result.image && !result.error) return;
    const revision = Number.isFinite(result.revision) ? result.revision : 0;
    const seen = revisionRef.current[hwnd] ?? -1;
    if (revision < seen) return;
    revisionRef.current[hwnd] = revision;
    if (result.image) {
      const image = result.image;
      setImages((existing) => (existing[hwnd] === image ? existing : { ...existing, [hwnd]: image }));
      setPreviewErrors((existing) => {
        if (!existing[hwnd]) return existing;
        const next = { ...existing };
        delete next[hwnd];
        return next;
      });
      return;
    }
    setImages((existing) => {
      if (!existing[hwnd]) return existing;
      const next = { ...existing };
      delete next[hwnd];
      return next;
    });
    const message = result.error && result.error.trim() ? result.error : "Preview unavailable";
    setPreviewErrors((existing) => (existing[hwnd] === message ? existing : { ...existing, [hwnd]: message }));
  }

  applyRef.current = applyPreview;

  function hydrate(items: ListedWindow[], dirty: readonly string[]) {
    const dirtySet = new Set(dirty);
    for (const item of items) {
      const hwnd = item.hwnd;
      const unresolved = !imagesRef.current[hwnd] && !previewErrorsRef.current[hwnd];
      if (!unresolved && !dirtySet.has(hwnd)) continue;
      if (inflightRef.current.has(hwnd)) continue;
      inflightRef.current.add(hwnd);
      invoke<WindowPreview>("capture_window", { hwnd, cacheOnly: true })
        .then((result) => applyRef.current(hwnd, result))
        .catch(() => {})
        .finally(() => {
          inflightRef.current.delete(hwnd);
        });
    }
  }

  function commit(next: ListedWindow[], foreground: string | null, generation: number) {
    if (generation < appliedRef.current) return;
    appliedRef.current = generation;
    const hwnd = selectedRef.current;
    const found = hwnd ? next.findIndex((item) => item.hwnd === hwnd) : -1;
    const resolved = found >= 0 ? found : selectionAfterShrink(indexRef.current, next.length).index;
    const dirty = dirtyWindows(snapshotRef.current, next, foreground, foregroundSeenRef.current);
    snapshotRef.current = next.map((item) => ({ hwnd: item.hwnd, title: item.title }));
    foregroundSeenRef.current = foreground;
    if (dirty.length > 0) {
      const dirtySet = new Set(dirty);
      setPreviewErrors((current) => {
        let changed = false;
        const cleared: Record<string, string> = {};
        for (const [key, message] of Object.entries(current)) {
          if (dirtySet.has(key)) {
            changed = true;
            continue;
          }
          cleared[key] = message;
        }
        return changed ? cleared : current;
      });
    }
    const listChanged = !sameWindows(windowsRef.current, next) || resolved !== indexRef.current;
    windowsRef.current = next;
    indexRef.current = resolved;
    selectedRef.current = next[resolved]?.hwnd ?? null;
    hasSuccessRef.current = true;
    if (listChanged) {
      setWindows(next);
      setIndex(resolved);
    }
    setPhase("ready");
    setListError(null);
    hydrate(next, dirty);
  }

  function applyList(next: ListedWindow[], foreground: string | null, generation: number, force: boolean) {
    if (holdRef.current && !force) {
      if (generation >= pendingGenRef.current) {
        pendingRef.current = next;
        pendingForegroundRef.current = foreground;
        pendingGenRef.current = generation;
      }
      return;
    }
    pendingRef.current = null;
    commit(next, foreground, generation);
  }

  function releaseHold() {
    const pending = pendingRef.current;
    if (!pending) return;
    const generation = pendingGenRef.current;
    const foreground = pendingForegroundRef.current;
    pendingRef.current = null;
    commit(pending, foreground, generation);
  }

  function reportHold(pointerInside: boolean, focusInside: boolean) {
    pointerInsideRef.current = pointerInside;
    focusInsideRef.current = focusInside;
    const held = pointerInside || focusInside || keyboardInsideRef.current;
    holdRef.current = held;
    if (!held) releaseHold();
  }

  function setKeyboardHold(held: boolean) {
    keyboardInsideRef.current = held;
    reportHold(pointerInsideRef.current, focusInsideRef.current);
  }

  function selectIndex(nextIndex: number) {
    const items = windowsRef.current;
    const committed = commitSelection(nextIndex, items.length);
    indexRef.current = committed.index;
    selectedRef.current = items[committed.index]?.hwnd ?? null;
    setIndex(committed.index);
  }

  stepRef.current = (delta: number) => {
    if (delta === 0 || windowsRef.current.length === 0) return;
    selectIndex(indexRef.current + delta);
  };

  async function load(force: boolean) {
    const generation = ++generationRef.current;
    try {
      const listed = await invoke<WindowList>("list_windows");
      applyList(listed.windows, listed.foregroundHwnd, generation, force);
    } catch (reason: unknown) {
      if (generation < appliedRef.current) return;
      setListError(messageFrom(reason));
      if (!hasSuccessRef.current) setPhase("error");
    }
  }

  refreshRef.current = (force: boolean) => {
    void load(force);
  };

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    let accum = 0;
    const onWheel = (event: WheelEvent) => {
      if (windowsRef.current.length === 0) return;
      event.preventDefault();
      const dominant = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      let delta = dominant;
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 32;
      else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= node.clientHeight || 120;
      accum += delta;
      while (accum >= WHEEL_THRESHOLD) {
        accum -= WHEEL_THRESHOLD;
        stepRef.current(1);
      }
      while (accum <= -WHEEL_THRESHOLD) {
        accum += WHEEL_THRESHOLD;
        stepRef.current(-1);
      }
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  useLayoutEffect(() => {
    const node = cardsRef.current;
    if (!node) return;
    const measure = () => {
      const width = node.clientWidth;
      const height = node.clientHeight;
      setStripSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [windows.length]);

  useLayoutEffect(() => {
    const node = cardsRef.current;
    if (!node) return;
    const lead = layout.scroll ? scrolled.pad : 0;
    if (node.scrollLeft !== lead) node.scrollLeft = lead;
  }, [index, layout.scroll, scrolled.pad]);

  useEffect(() => {
    if (!inApp) return;
    let alive = true;
    let timer = 0;
    let unlisten: (() => void) | undefined;
    let unlistenVisibility: (() => void) | undefined;

    const stop = () => {
      window.clearInterval(timer);
      timer = 0;
    };
    const start = () => {
      refreshRef.current(false);
      if (timer !== 0) return;
      timer = window.setInterval(() => refreshRef.current(false), POLL_MS);
    };
    const releasePointer = () => {
      pointerInsideRef.current = false;
      focusInsideRef.current = false;
      keyboardInsideRef.current = false;
      holdRef.current = false;
      releaseHold();
    };

    listen<PreviewUpdate>("window-preview", (event) => {
      if (!alive) return;
      applyRef.current(event.payload.hwnd, event.payload);
    }).then((stopListening) => {
      if (!alive) stopListening();
      else unlisten = stopListening;
    });

    listen<{ visible: boolean }>("hud-visibility", (event) => {
      if (!alive) return;
      if (event.payload.visible) refreshRef.current(false);
      else releasePointer();
    }).then((stopListening) => {
      if (!alive) stopListening();
      else unlistenVisibility = stopListening;
    });

    start();

    return () => {
      alive = false;
      stop();
      unlisten?.();
      unlistenVisibility?.();
    };
  }, [inApp]);

  useEffect(() => {
    const live = new Set(windows.map((item) => item.hwnd));
    for (const hwnd of Object.keys(revisionRef.current)) {
      if (!live.has(hwnd)) delete revisionRef.current[hwnd];
    }
    setCardErrors((current) => {
      const next: Record<string, string> = {};
      for (const item of windows) {
        const message = current[item.hwnd];
        if (message) next[item.hwnd] = message;
      }
      return Object.keys(current).length === Object.keys(next).length ? current : next;
    });
    setPreviewErrors((current) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [hwnd, message] of Object.entries(current)) {
        if (!live.has(hwnd)) {
          changed = true;
          continue;
        }
        next[hwnd] = message;
      }
      return changed ? next : current;
    });
    setImages((current) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [hwnd, image] of Object.entries(current)) {
        if (!live.has(hwnd)) {
          changed = true;
          continue;
        }
        next[hwnd] = image;
      }
      return changed ? next : current;
    });
    setHoverIndex((current) => (current !== null && current < windows.length ? current : null));
  }, [windows]);

  const previewHwnd = frame.previewHwnd;
  const current = previewHwnd ? (windows[frame.index] ?? null) : null;

  useEffect(() => {
    if (!current || !inApp) return;
    const hwnd = current.hwnd;
    invoke<WindowPreview>("capture_window", { hwnd })
      .then((result) => {
        applyRef.current(hwnd, result);
      })
      .catch((reason: unknown) => {
        if (imagesRef.current[hwnd]) return;
        applyRef.current(hwnd, {
          image: null,
          error: messageFrom(reason),
          revision: revisionRef.current[hwnd] ?? 0,
        });
      });
  }, [current?.hwnd, current?.title, inApp]);

  function clearCardError(hwnd: string) {
    setCardErrors((existing) => {
      if (!existing[hwnd]) return existing;
      const next = { ...existing };
      delete next[hwnd];
      return next;
    });
  }

  async function activateWindow(hwnd: string) {
    clearCardError(hwnd);
    try {
      await invoke("activate_window", { hwnd });
    } catch (reason: unknown) {
      setCardErrors((existing) => ({ ...existing, [hwnd]: messageFrom(reason) }));
    }
  }

  async function closeWindow(hwnd: string) {
    clearCardError(hwnd);
    try {
      await invoke("close_window", { hwnd });
      window.setTimeout(() => refreshRef.current(true), CLOSE_REFRESH_MS);
    } catch (reason: unknown) {
      setCardErrors((existing) => ({ ...existing, [hwnd]: messageFrom(reason) }));
    }
  }

  function cardIndexFrom(target: EventTarget | null): number | null {
    if (!(target instanceof Element)) return null;
    const card = target.closest(".window-card");
    if (!(card instanceof HTMLElement)) return null;
    const index = Number(card.dataset.index);
    return Number.isInteger(index) ? index : null;
  }

  function pressCard(cardIndex: number) {
    const decision = pointerResolution("click", indexRef.current, cardIndex);
    selectIndex(decision.selectedIndex);
    if (!decision.activate) return;
    const hwnd = windowsRef.current[decision.selectedIndex]?.hwnd;
    if (hwnd) void activateWindow(hwnd);
  }

  function finishDrag(event: React.PointerEvent<HTMLDivElement>, activate: boolean) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const scrubbed = drag.scrubbed;
    const cardIndex = drag.cardIndex;
    dragRef.current = null;
    setScrubbing(false);
    if (scrubbed || !activate || cardIndex === null) {
      if (scrubbed) suppressClickRef.current = true;
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest(".window-card__close")) return;
    // The click that follows this pointerup would activate the card a second time.
    suppressClickRef.current = true;
    pressCard(cardIndex);
  }

  function onStripPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    suppressClickRef.current = false;
    const target = event.target;
    if (target instanceof Element && target.closest(".window-card__close")) return;
    event.stopPropagation();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startIndex: indexRef.current,
      cardIndex: cardIndexFrom(target),
      scrubbed: false,
    };
    // Capturing here retargets the click onto the strip, so the card never receives it.
    // Capture starts only once the press becomes a drag.
  }

  function onStripPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    if (!drag.scrubbed) {
      if (Math.abs(dx) < DRAG_SLOP) return;
      drag.scrubbed = true;
      setScrubbing(true);
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    }
    const next = indexAfterDrag(drag.startIndex, dx, layoutStepRef.current, windowsRef.current.length);
    const decision = pointerResolution("scrub", drag.startIndex, next);
    if (decision.selectedIndex !== indexRef.current) selectIndex(decision.selectedIndex);
  }

  useImperativeHandle(
    ref,
    () => ({
      count: () => windowsRef.current.length,
      focusSelection: () => selectIndex(indexRef.current),
      move: (delta: number) => stepRef.current(delta),
      activateSelected: () => {
        const hwnd = selectedRef.current;
        if (hwnd) void activateWindow(hwnd);
      },
      setKeyboardHold,
    }),
    [windows],
  );

  const selectedImage = selectedPreviewImage(images, previewHwnd);
  const selectedPreviewError = previewHwnd ? (previewErrors[previewHwnd] ?? null) : null;
  const showReading = phase === "reading" && windows.length === 0 && !listError;
  const showEmpty = phase === "ready" && windows.length === 0 && !listError;

  return (
    <section
      ref={sectionRef}
      className="window-stack glass-panel float-panel"
      data-region="window-stack"
      aria-label="Window stack"
      onPointerEnter={() => reportHold(true, focusInsideRef.current)}
      onPointerDown={() => reportHold(true, focusInsideRef.current)}
      onPointerMove={() => {
        if (!pointerInsideRef.current) reportHold(true, focusInsideRef.current);
      }}
      onPointerLeave={() => reportHold(false, focusInsideRef.current)}
      onFocus={() => reportHold(pointerInsideRef.current, true)}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        reportHold(pointerInsideRef.current, false);
      }}
    >
      {listError ? <p className="window-stack__status window-stack__status--error error">{listError}</p> : null}
      {showReading ? <p className="window-stack__status">Reading windows…</p> : null}
      {showEmpty ? <p className="window-stack__status">No other windows are open.</p> : null}
      {current && previewHwnd === current.hwnd ? (
        <div className="window-stack__preview glass-panel" data-no-drag>
          {selectedImage ? (
            <img src={selectedImage} alt="" />
          ) : (
            <p className="window-stack__preview-note" title={selectedPreviewError ?? undefined}>
              {selectedPreviewError ? "Preview unavailable" : "Reading preview…"}
            </p>
          )}
          <p className="window-stack__preview-title">{frame.title}</p>
        </div>
      ) : null}
      {windows.length > 0 ? (
        <div
          className="window-stack__cards"
          data-no-drag
          data-scroll={layout.scroll ? "true" : "false"}
          data-scrubbing={scrubbing ? "true" : "false"}
          ref={cardsRef}
          onPointerDown={onStripPointerDown}
          onPointerMove={onStripPointerMove}
          onPointerUp={(event) => finishDrag(event, true)}
          onPointerCancel={(event) => finishDrag(event, false)}
        >
          {layout.scroll ? <div className="window-stack__sizer" style={{ width: scrolled.track }} /> : null}
          {windows.map((item, cardIndex) => {
            const card = layout.cards[cardIndex];
            const role = cardRole(cardIndex, frame.index, hoverIndex);
            const cardError = cardErrors[item.hwnd];
            const cardImage = images[item.hwnd] ?? null;
            const cardPreviewError = previewErrors[item.hwnd] ?? null;
            const placed = card ?? { x: 0, y: 0, width: 0, height: 0, z: cardIndex + 1, scale: 1 };
            return (
              <div
                key={item.hwnd}
                className="window-card"
                style={{
                  width: placed.width,
                  height: placed.height,
                  zIndex: placed.z,
                  transform: `translate3d(${placed.x + layout.translateX + scrolled.pad}px, ${placed.y}px, 0) scale(${placed.scale})`,
                }}
                data-hwnd={item.hwnd}
                data-index={cardIndex}
                data-active={role === "selected" ? "true" : "false"}
                data-hover={role === "hovered" ? "true" : "false"}
                data-side={cardIndex < frame.index ? "left" : "right"}
                data-no-drag
                role="button"
                tabIndex={0}
                aria-selected={role === "selected"}
                onPointerEnter={() => {
                  const kept = selectionAfterHover(indexRef.current, cardIndex, windowsRef.current.length);
                  if (kept.index !== indexRef.current) selectIndex(kept.index);
                  setHoverIndex(cardIndex);
                }}
                onPointerLeave={() => {
                  setHoverIndex((existing) => (existing === cardIndex ? null : existing));
                }}
                onClick={(event) => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                  }
                  const target = event.target;
                  if (target instanceof Element && target.closest(".window-card__close")) return;
                  pressCard(cardIndex);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  if (event.target instanceof Element && event.target.closest(".window-card__close")) return;
                  event.preventDefault();
                  event.stopPropagation();
                  pressCard(cardIndex);
                }}
              >
                {cardImage ? (
                  <img className="window-card__shot" src={cardImage} alt="" />
                ) : (
                  <span className="window-card__placeholder" data-state={cardPreviewError ? "unavailable" : "loading"} aria-hidden="true">
                    {cardPreviewError ? "Preview unavailable" : null}
                  </span>
                )}
                <span className="window-card__title">{item.title}</span>
                {cardError ? <span className="window-card__error error">{cardError}</span> : null}
                <button
                  type="button"
                  className="window-card__close"
                  data-no-drag
                  aria-label={`Close ${item.title}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    void closeWindow(item.hwnd);
                  }}
                >
                  <CloseIcon />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
});

export default WindowStack;
