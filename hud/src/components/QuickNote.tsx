import type { RefObject } from "react";

type QuickNoteProps = {
  value: string;
  onChange: (value: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  error: string | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
};

const PREVIEW_CHARS = 80;

/** First line of the raw note, or the start of the text, capped for the collapsed chip. */
function collapsedNoteText(value: string): string {
  const firstLine = (value.split(/\r?\n/, 1)[0] ?? "").trim();
  const source = firstLine.length > 0 ? firstLine : value.trim().replace(/\s+/g, " ");
  if (source.length <= PREVIEW_CHARS) return source;
  return `${source.slice(0, PREVIEW_CHARS).trimEnd()}…`;
}

export default function QuickNote({ value, onChange, open, onOpenChange, error, inputRef }: QuickNoteProps) {
  const empty = value.trim().length === 0;
  const preview = collapsedNoteText(value);

  return (
    <section
      className="quick-note glass-panel float-panel"
      data-region="quick-note"
      data-open={open ? "true" : "false"}
      data-empty={empty ? "true" : "false"}
      aria-label="Quick note"
    >
      {open ? (
        <div className="quick-note__editor" id="quick-note-editor">
          <div className="quick-note__heading">
            <button type="button" className="quick-note__heading-button" onClick={() => onOpenChange(false)}>
              Quick note
            </button>
            <button type="button" className="quick-note__close" aria-label="Collapse note" onClick={() => onOpenChange(false)}>
              ×
            </button>
          </div>
          {error ? <p className="quick-note__error error">{error}</p> : null}
          <textarea
            ref={inputRef}
            className="quick-note__input"
            aria-label="Note text"
            placeholder="Markdown is stored as typed — # headings, **bold**, lists, - [ ] checks, and links."
            value={value}
            onChange={(event) => onChange(event.target.value)}
            spellCheck
          />
        </div>
      ) : (
        <button type="button" className="quick-note__toggle" aria-expanded={false} onClick={() => onOpenChange(true)}>
          <span className="quick-note__preview">{preview || "Quick note"}</span>
        </button>
      )}
      {!open && error ? <p className="quick-note__error error">{error}</p> : null}
    </section>
  );
}
