import { useState } from "react";
import type { WidgetInstance } from "../layout/types";
import { libraryEntries, type LibraryRestoreRow } from "../widgets/library";
import { widgetRegistry } from "../widgets/registry";
import type { WidgetStateDocument } from "../widgets/shortcuts";

export type HiddenPiece = {
  id: string;
  title: string;
};

type WidgetLibraryProps = {
  hidden: HiddenPiece[];
  widgets: readonly Pick<WidgetInstance, "id" | "type" | "variant" | "visibility">[];
  widgetState: WidgetStateDocument;
  onAdd: (type: string, variant: string) => void;
  onRestore: (id: string) => string | null;
  onRestoreWidget: (id: string) => void;
  onClose: () => void;
};

function retainedLabel(row: LibraryRestoreRow, rows: readonly LibraryRestoreRow[]): string {
  const shared = rows.filter((item) => item.variant === row.variant).length > 1;
  return shared ? `${row.variant} (${row.id})` : row.variant;
}

export default function WidgetLibrary({ hidden, widgets, widgetState, onAdd, onRestore, onRestoreWidget, onClose }: WidgetLibraryProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [variantByType, setVariantByType] = useState<Record<string, string>>({});

  function restore(id: string) {
    setMessage(onRestore(id));
  }

  const entries = libraryEntries(widgets, widgetState);

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
                const model = entries.find((item) => item.type === entry.type);
                const canAdd = model?.canAdd === true;
                const restores = model?.restores ?? [];
                const variant = variantByType[entry.type] ?? entry.sizes[0]?.id ?? "";
                const Preview = entry.Preview;
                return (
                  <article key={entry.type} className="widget-library__card">
                    <h4 className="widget-library__card-title">{entry.title}</h4>
                    <p className="widget-library__description">{entry.description}</p>
                    <div className="widget-library__preview">
                      <Preview />
                    </div>
                    {canAdd && entry.sizes.length > 1 ? (
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
                    {canAdd ? (
                      <button
                        type="button"
                        className="widget-library__add"
                        disabled={variant.length === 0}
                        onClick={() => onAdd(entry.type, variant)}
                      >
                        Add
                      </button>
                    ) : null}
                    {restores.length > 0 ? (
                      <ul className="widget-library__retained" aria-label={`${entry.title} saved`}>
                        {restores.map((row) => (
                          <li key={row.id} className="widget-library__hidden-row" data-instance={row.id}>
                            <span>{retainedLabel(row, restores)}</span>
                            <button type="button" className="widget-library__restore" onClick={() => onRestoreWidget(row.id)}>
                              Restore
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
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
