import { useState } from "react";
import { widgetRegistry } from "../widgets/registry";

export type HiddenPiece = {
  id: string;
  title: string;
};

type WidgetLibraryProps = {
  hidden: HiddenPiece[];
  widgets: { type: string }[];
  onAdd: (type: string, variant: string) => void;
  onRestore: (id: string) => string | null;
  onClose: () => void;
};

export default function WidgetLibrary({ hidden, widgets, onAdd, onRestore, onClose }: WidgetLibraryProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [variantByType, setVariantByType] = useState<Record<string, string>>({});

  function restore(id: string) {
    setMessage(onRestore(id));
  }

  return (
    <div className="widget-library__backdrop" onPointerDown={onClose}>
      <div
        className="widget-library glass-panel"
        role="dialog"
        aria-label="Widget library"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="widget-library__header">
          <h2 className="widget-library__title">Widget library</h2>
          <button type="button" className="widget-library__close" aria-label="Close widget library" onClick={onClose}>
            ×
          </button>
        </header>
        {message ? <p className="widget-library__note">{message}</p> : null}
        <section className="widget-library__section" aria-label="Widgets">
          <h3 className="kicker">Widgets</h3>
          {widgetRegistry.length === 0 ? (
            <p className="widget-library__empty">No widgets are registered yet.</p>
          ) : (
            <div className="widget-library__cards">
              {widgetRegistry.map((entry) => {
                const added = widgets.some((widget) => widget.type === entry.type);
                const variant = variantByType[entry.type] ?? entry.sizes[0]?.id ?? "";
                const Preview = entry.Preview;
                return (
                  <article key={entry.type} className="widget-library__card">
                    <h4 className="widget-library__card-title">{entry.title}</h4>
                    <p className="widget-library__description">{entry.description}</p>
                    <div className="widget-library__preview">
                      <Preview />
                    </div>
                    {entry.sizes.length > 1 ? (
                      <div className="widget-library__sizes">
                        {entry.sizes.map((size) => (
                          <button
                            key={size.id}
                            type="button"
                            className="glass-menu__item"
                            aria-pressed={variant === size.id}
                            onClick={() => setVariantByType((current) => ({ ...current, [entry.type]: size.id }))}
                          >
                            {size.id}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="widget-library__add"
                      disabled={added || variant.length === 0}
                      onClick={() => onAdd(entry.type, variant)}
                    >
                      {added ? "Added" : "Add"}
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>
        <section className="widget-library__section" aria-label="Hidden">
          <h3 className="kicker">Hidden</h3>
          {hidden.length === 0 ? (
            <p className="widget-library__empty">Nothing is hidden.</p>
          ) : (
            <ul className="widget-library__hidden">
              {hidden.map((piece) => (
                <li key={piece.id} className="widget-library__hidden-row">
                  <span>{piece.title}</span>
                  <button type="button" className="widget-library__restore" onClick={() => restore(piece.id)}>
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
