import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { runningInTauri } from "../tauri";
import SuggestionPreview from "./SuggestionPreview";

export type ActionCard = {
  kind: string;
  title: string;
  detail: string;
};

export type SuggestionError = {
  message: string;
  kind: string | null;
};

type SuggestionsProps = {
  actions: ActionCard[];
  suggestedKind: string | null;
  reason: string | null;
  error: SuggestionError | null;
  onOpen: (kind: string) => void;
  onHoldChange?: (held: boolean) => void;
  keyboardActive?: boolean;
};

export type SuggestionsHandle = {
  count: () => number;
  focusSelection: () => void;
  move: (delta: number) => void;
  activateSelected: () => void;
  setKeyboardHold: (held: boolean) => void;
};

export const SUGGESTION_CARD_LIMIT = 3;
const SUGGESTION_CARD_MAX = 8;

const Suggestions = forwardRef<SuggestionsHandle, SuggestionsProps>(function Suggestions(
  { actions, suggestedKind, reason, error, onOpen, onHoldChange, keyboardActive = false },
  ref,
) {
  const [expanded, setExpanded] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const pointerInsideRef = useRef(false);
  const focusInsideRef = useRef(false);
  const keyboardInsideRef = useRef(false);
  const sectionRef = useRef<HTMLElement>(null);
  const onHoldChangeRef = useRef(onHoldChange);
  const onOpenRef = useRef(onOpen);
  onHoldChangeRef.current = onHoldChange;
  onOpenRef.current = onOpen;
  const listed = actions.slice(0, SUGGESTION_CARD_MAX);
  const canExpand = listed.length > SUGGESTION_CARD_LIMIT;
  const visible = expanded && canExpand ? listed : listed.slice(0, SUGGESTION_CARD_LIMIT);
  const hiddenCount = listed.length - visible.length;
  const suggestedIndex = suggestedKind === null ? -1 : visible.findIndex((action) => action.kind === suggestedKind);
  const panelError = error && error.kind === null ? error.message : null;
  const visibleRef = useRef(visible);
  const highlightRef = useRef(highlight);
  visibleRef.current = visible;
  highlightRef.current = highlight;

  useEffect(() => {
    setHighlight((current) => {
      if (visible.length === 0) return 0;
      return Math.min(current, visible.length - 1);
    });
  }, [visible.length]);

  useEffect(() => {
    if (!keyboardActive) return;
    const section = sectionRef.current;
    const card = section?.querySelector<HTMLElement>(`[data-index="${highlight}"]`);
    if (!section || !card) return;
    const sectionRect = section.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    if (cardRect.top < sectionRect.top) {
      section.scrollTop -= sectionRect.top - cardRect.top;
    } else if (cardRect.bottom > sectionRect.bottom) {
      section.scrollTop += cardRect.bottom - sectionRect.bottom;
    }
  }, [keyboardActive, highlight, visible.length]);

  useEffect(() => {
    return () => {
      keyboardInsideRef.current = false;
      onHoldChangeRef.current?.(false);
    };
  }, []);

  useEffect(() => {
    if (!runningInTauri()) return;
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen<{ visible: boolean }>("hud-visibility", (event) => {
      if (!alive || event.payload.visible) return;
      keyboardInsideRef.current = false;
      onHoldChangeRef.current?.(pointerInsideRef.current || focusInsideRef.current);
    }).then((stop) => {
      if (alive) unlisten = stop;
      else stop();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  function reportHold(pointerInside: boolean, focusInside: boolean) {
    pointerInsideRef.current = pointerInside;
    focusInsideRef.current = focusInside;
    onHoldChangeRef.current?.(pointerInside || focusInside || keyboardInsideRef.current);
  }

  function setKeyboardHold(held: boolean) {
    keyboardInsideRef.current = held;
    reportHold(pointerInsideRef.current, focusInsideRef.current);
  }

  useImperativeHandle(
    ref,
    () => ({
      count: () => visibleRef.current.length,
      focusSelection: () => {
        const count = visibleRef.current.length;
        if (count === 0) return;
        setHighlight((current) => Math.min(Math.max(current, 0), count - 1));
      },
      move: (delta: number) => {
        const count = visibleRef.current.length;
        if (count === 0 || delta === 0) return;
        setHighlight((current) => Math.min(Math.max(current + delta, 0), count - 1));
      },
      activateSelected: () => {
        const action = visibleRef.current[highlightRef.current];
        if (action) onOpenRef.current(action.kind);
      },
      setKeyboardHold,
    }),
    [visible.length],
  );

  return (
    <section
      ref={sectionRef}
      className="suggestions glass-panel float-panel"
      data-region="suggestions"
      data-suggested-kind={suggestedKind ?? ""}
      data-expanded={expanded && canExpand ? "true" : "false"}
      aria-label="Suggestions"
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
      {panelError ? <p className="suggestions__error error">{panelError}</p> : null}
      {actions.length === 0 ? (
        <p className="suggestions__scanning">Scanning for suggestions...</p>
      ) : (
        <div className="suggestions__list" data-count={visible.length}>
          {visible.map((action, index) => {
            const suggested = index === suggestedIndex;
            const highlighted = keyboardActive && index === highlight;
            const cardError = error?.kind === action.kind ? error.message : null;
            return (
              <article
                key={action.kind}
                className={suggested ? "suggestion-card suggestion-card--suggested" : "suggestion-card"}
                data-kind={action.kind}
                data-index={index}
                data-suggested={suggested ? "true" : "false"}
                data-highlighted={highlighted ? "true" : "false"}
              >
                <div className="suggestion-card__body">
                  <SuggestionPreview kind={action.kind} title={action.title} />
                  <p className="kicker suggestion-card__kicker">
                    {suggested ? "Suggested" : suggestedKind ? "Also" : "Open"}
                  </p>
                  <h2 className="suggestion-card__title">{action.title}</h2>
                  <p className="detail suggestion-card__detail">{action.detail}</p>
                  {suggested && reason ? <p className="reason suggestion-card__reason">{reason}</p> : null}
                  {cardError ? <p className="suggestion-card__error error">{cardError}</p> : null}
                </div>
                <button type="button" className="suggestion-card__open" onClick={() => onOpen(action.kind)}>
                  Open
                </button>
              </article>
            );
          })}
        </div>
      )}
      {canExpand ? (
        <button
          type="button"
          className="suggestions__expand"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show less" : `Show ${hiddenCount} more`}
        </button>
      ) : null}
    </section>
  );
});

export default Suggestions;
