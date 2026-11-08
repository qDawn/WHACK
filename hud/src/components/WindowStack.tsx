import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { runningInTauri } from "../tauri";

type ListedWindow = {
  hwnd: string;
  processName: string;
  title: string;
};

type WindowPreview = {
  image: string | null;
  error: string | null;
};

type PreviewState = {
  hwnd: string;
  image: string | null;
  pending: boolean;
  error: string | null;
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

function messageFrom(reason: unknown): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message;
  if (typeof reason === "string" && reason.trim()) return reason;
  return "Could not read windows.";
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
  const pendingGenRef = useRef(0);
  const appliedRef = useRef(0);
  const generationRef = useRef(0);
  const hasSuccessRef = useRef(false);
  const stepRef = useRef<(delta: number) => void>(() => {});
  const refreshRef = useRef<(force: boolean) => void>(() => {});

  const [phase, setPhase] = useState<Phase>(inApp ? "reading" : "error");
  const [windows, setWindows] = useState<ListedWindow[]>([]);
  const [index, setIndex] = useState(0);
  const [listError, setListError] = useState<string | null>(
    inApp ? null : "Window list is available in the Aura window.",
  );
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewArmed, setPreviewArmed] = useState(false);

  windowsRef.current = windows;
  indexRef.current = index;
  selectedRef.current = windows[index]?.hwnd ?? null;

  function commit(next: ListedWindow[], generation: number) {
    if (generation < appliedRef.current) return;
    appliedRef.current = generation;
    const hwnd = selectedRef.current;
    let resolved = 0;
    if (next.length > 0) {
      const found = hwnd ? next.findIndex((item) => item.hwnd === hwnd) : -1;
      resolved = found >= 0 ? found : Math.min(indexRef.current, next.length - 1);
    }
    windowsRef.current = next;
    indexRef.current = resolved;
    selectedRef.current = next[resolved]?.hwnd ?? null;
    hasSuccessRef.current = true;
    setWindows(next);
    setIndex(resolved);
    setPhase("ready");
    setListError(null);
  }

  function applyList(next: ListedWindow[], generation: number, force: boolean) {
    if (holdRef.current && !force) {
      if (generation >= pendingGenRef.current) {
        pendingRef.current = next;
        pendingGenRef.current = generation;
      }
      return;
    }
    pendingRef.current = null;
    commit(next, generation);
  }

  function releaseHold() {
    const pending = pendingRef.current;
    if (!pending) return;
    const generation = pendingGenRef.current;
    pendingRef.current = null;
    commit(pending, generation);
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
    const count = items.length;
    const resolved = count === 0 ? 0 : Math.min(Math.max(nextIndex, 0), count - 1);
    indexRef.current = resolved;
    selectedRef.current = items[resolved]?.hwnd ?? null;
    setPreviewArmed(true);
    setIndex(resolved);
  }

  stepRef.current = (delta: number) => {
    if (delta === 0 || windowsRef.current.length === 0) return;
    selectIndex(indexRef.current + delta);
  };

  async function load(force: boolean) {
    const generation = ++generationRef.current;
    try {
      const listed = await invoke<ListedWindow[]>("list_windows");
      applyList(listed, generation, force);
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
      let delta = event.deltaY;
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

  useEffect(() => {
    if (!inApp) return;
    let alive = true;
    let timer = 0;
    let unlisten: (() => void) | undefined;

    const stop = () => {
      window.clearInterval(timer);
      timer = 0;
    };
    const start = () => {
      refreshRef.current(false);
      if (timer !== 0) return;
      timer = window.setInterval(() => refreshRef.current(false), POLL_MS);
    };
    const hide = () => {
      stop();
      pointerInsideRef.current = false;
      focusInsideRef.current = false;
      keyboardInsideRef.current = false;
      holdRef.current = false;
      releaseHold();
    };

    listen<{ visible: boolean }>("hud-visibility", (event) => {
      if (!alive) return;
      if (event.payload.visible) start();
      else hide();
    }).then((stopListening) => {
      if (!alive) {
        stopListening();
        return;
      }
      unlisten = stopListening;
      if (document.documentElement.dataset.hudVisible === "true") start();
    });

    const kick = window.setTimeout(() => {
      if (!alive) return;
      if (document.documentElement.dataset.hudVisible === "true") start();
    }, 0);

    return () => {
      alive = false;
      window.clearTimeout(kick);
      stop();
      unlisten?.();
    };
  }, [inApp]);

  useEffect(() => {
    const container = cardsRef.current;
    const card = container?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!container || !card) return;
    const containerRect = container.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    if (cardRect.top < containerRect.top) {
      container.scrollTop -= containerRect.top - cardRect.top;
    } else if (cardRect.bottom > containerRect.bottom) {
      container.scrollTop += cardRect.bottom - containerRect.bottom;
    }
  }, [index, windows]);

  useEffect(() => {
    setCardErrors((current) => {
      const next: Record<string, string> = {};
      for (const item of windows) {
        const message = current[item.hwnd];
        if (message) next[item.hwnd] = message;
      }
      return Object.keys(current).length === Object.keys(next).length ? current : next;
    });
  }, [windows]);

  const current = windows[index] ?? null;

  useEffect(() => {
    if (!current || !inApp || !previewArmed) {
      setPreview(null);
      return;
    }
    let alive = true;
    const hwnd = current.hwnd;
    setPreview({ hwnd, image: null, pending: true, error: null });
    invoke<WindowPreview>("capture_window", { hwnd })
      .then((result) => {
        if (!alive) return;
        setPreview({
          hwnd,
          image: result.image,
          pending: false,
          error: result.error,
        });
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setPreview({ hwnd, image: null, pending: false, error: messageFrom(reason) });
      });
    return () => {
      alive = false;
    };
  }, [current?.hwnd, current?.title, inApp, previewArmed]);

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

  const shot = preview && current && preview.hwnd === current.hwnd ? preview : null;
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
      {current ? (
        <div className="window-stack__preview glass-panel" data-no-drag>
          {shot?.image ? (
            <img src={shot.image} alt="" />
          ) : shot ? (
            <p className="window-stack__preview-note" title={shot.error ?? undefined}>
              {shot.pending ? "Reading preview…" : "Preview unavailable"}
            </p>
          ) : null}
          <p className="window-stack__preview-title">{current.title}</p>
        </div>
      ) : null}
      {windows.length > 0 ? (
        <div className="window-stack__cards" data-no-drag ref={cardsRef}>
          {windows.map((item, cardIndex) => {
            const active = cardIndex === index;
            const cardError = cardErrors[item.hwnd];
            return (
              <div
                key={item.hwnd}
                className="window-card"
                style={{ zIndex: cardIndex + 1 }}
                data-hwnd={item.hwnd}
                data-index={cardIndex}
                data-active={active ? "true" : "false"}
                data-no-drag
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  const target = event.target;
                  if (target instanceof Element && target.closest(".window-card__close")) return;
                  void activateWindow(item.hwnd);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  void activateWindow(item.hwnd);
                }}
                onPointerEnter={() => selectIndex(cardIndex)}
                onFocus={() => selectIndex(cardIndex)}
              >
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
