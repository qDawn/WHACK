import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useWidgetRuntime } from "./runtime";
import {
  SHORTCUT_VARIANTS,
  shortcutActivation,
  shortcutColumns,
  shortcutLabel,
  shortcutMark,
  shortcutPreviewModel,
  suggestionCandidates,
} from "./shortcuts";

type ShortcutConfigProps = {
  instanceId: string;
  variant: string;
  ids: readonly string[];
  onClose: () => void;
};

function ShortcutConfig({ instanceId, variant, ids, onClose }: ShortcutConfigProps) {
  const runtime = useWidgetRuntime();
  if (!runtime) return null;
  const owned = new Set(ids);
  const candidates = suggestionCandidates(runtime.actions);

  function add(id: string) {
    if (owned.has(id)) return;
    runtime?.addShortcut(instanceId, id);
  }

  return createPortal(
    <div className="shortcut-config__backdrop" onPointerDown={onClose}>
      <div
        className="shortcut-config glass-panel"
        role="dialog"
        aria-label="Configure shortcuts"
        data-instance={instanceId}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="shortcut-config__header">
          <h2 className="shortcut-config__title">Shortcuts</h2>
          <button type="button" className="shortcut-config__close" aria-label="Close shortcut configuration" onClick={onClose}>
            ×
          </button>
        </header>
        <section className="shortcut-config__section" aria-label="Size">
          <p className="kicker">Size</p>
          <div className="shortcut-config__sizes">
            {SHORTCUT_VARIANTS.map((size) => (
              <button
                key={size.id}
                type="button"
                className="glass-menu__item"
                aria-pressed={variant === size.id}
                onClick={() => runtime.setVariant(instanceId, size.id)}
              >
                {size.id}
              </button>
            ))}
          </div>
        </section>
        <section className="shortcut-config__section" aria-label="Suggestions">
          <p className="kicker">Suggestions</p>
          {candidates.length === 0 ? <p className="shortcut-config__status">No suggestions right now.</p> : null}
          {candidates.map((kind) => {
            const title = shortcutLabel(kind, runtime.catalog, runtime.actions);
            const added = owned.has(kind);
            return (
              <button key={kind} type="button" className="glass-menu__item" disabled={added} onClick={() => add(kind)}>
                <span className="shortcut-config__choice">
                  <span className="shortcut-widget__mark" aria-hidden="true">
                    {shortcutMark(title)}
                  </span>
                  <span>{title}</span>
                </span>
                <span className="shortcut-config__meta">{added ? "Added" : "Add"}</span>
              </button>
            );
          })}
        </section>
        <section className="shortcut-config__section" aria-label="Catalog">
          <p className="kicker">Catalog</p>
          <CatalogAdds owned={owned} onAdd={add} />
        </section>
        <section className="shortcut-config__section" aria-label="In this widget">
          <p className="kicker">In this widget</p>
          {ids.length === 0 ? <p className="shortcut-config__status">Nothing in this widget yet.</p> : null}
          {ids.map((id) => {
            const title = shortcutLabel(id, runtime.catalog, runtime.actions);
            return (
              <button
                key={id}
                type="button"
                className="glass-menu__item"
                aria-label={`Remove ${title}`}
                onClick={() => runtime.removeShortcut(instanceId, id)}
              >
                <span className="shortcut-config__choice">
                  <span className="shortcut-widget__mark" aria-hidden="true">
                    {shortcutMark(title)}
                  </span>
                  <span>{title}</span>
                </span>
                <span className="shortcut-config__meta">Remove</span>
              </button>
            );
          })}
        </section>
      </div>
    </div>,
    document.body,
  );
}

function CatalogAdds({ owned, onAdd }: { owned: Set<string>; onAdd: (id: string) => void }) {
  const runtime = useWidgetRuntime();
  if (!runtime) return null;
  if (runtime.catalogStatus === "loading") return <p className="shortcut-config__status">Loading catalog...</p>;
  if (runtime.catalogStatus === "unavailable") {
    return <p className="shortcut-config__status">The catalog loads in the Aura window.</p>;
  }
  if (runtime.catalogStatus === "error") {
    return <p className="shortcut-config__status shortcut-config__status--error">{runtime.catalogError || "Could not read the catalog."}</p>;
  }
  if (runtime.catalog.length === 0) return <p className="shortcut-config__status">No apps in the catalog.</p>;
  return (
    <>
      {runtime.catalog.map((entry) => {
        const added = owned.has(entry.id);
        const title = entry.title || entry.id;
        return (
          <button key={entry.id} type="button" className="glass-menu__item" disabled={added} onClick={() => onAdd(entry.id)}>
            <span className="shortcut-config__choice">
              <span className="shortcut-widget__mark" aria-hidden="true">
                {shortcutMark(title)}
              </span>
              <span>{title}</span>
            </span>
            <span className="shortcut-config__meta">{added ? "Added" : "Add"}</span>
          </button>
        );
      })}
    </>
  );
}

export function ShortcutPreview() {
  return (
    <div className="shortcut-preview" aria-hidden="true">
      {shortcutPreviewModel().map((label) => (
        <span key={label} className="shortcut-preview__cell">
          <span className="shortcut-preview__mark">{shortcutMark(label)}</span>
          <span>{label}</span>
        </span>
      ))}
    </div>
  );
}

export default function ShortcutWidget({ instanceId }: { instanceId: string }) {
  const runtime = useWidgetRuntime();
  const editMode = runtime?.editMode ?? false;
  const variant = runtime?.variantOf(instanceId) ?? "compact";
  const ids = runtime?.idsOf(instanceId) ?? [];
  const [configOpen, setConfigOpen] = useState(false);

  useEffect(() => {
    if (!editMode) setConfigOpen(false);
  }, [editMode]);

  useEffect(() => {
    if (!configOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      setConfigOpen(false);
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [configOpen]);

  function activate(id: string) {
    const request = shortcutActivation(editMode, id);
    if (!request) {
      if (editMode) setConfigOpen(true);
      return;
    }
    runtime?.openKind(request.kind);
  }

  const columns = shortcutColumns(variant);

  return (
    <section className={ids.length === 0 ? "shortcut-widget shortcut-widget--empty glass-panel" : "shortcut-widget glass-panel"} aria-label="Shortcuts" data-instance={instanceId} data-variant={variant}>
      {editMode ? (
        <button type="button" className="shortcut-widget__configure" data-no-drag onClick={() => setConfigOpen(true)}>
          {ids.length === 0 ? "Add shortcuts" : "Edit shortcuts"}
        </button>
      ) : ids.length === 0 ? (
        <p className="shortcut-widget__empty">Add shortcuts</p>
      ) : null}
      {ids.length > 0 ? (
        <div className="shortcut-widget__grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {ids.map((id) => {
            const title = shortcutLabel(id, runtime?.catalog ?? [], runtime?.actions ?? []);
            const cellError = runtime?.error?.kind === id ? runtime.error.message : null;
            return (
              <button
                key={id}
                type="button"
                className="shortcut-widget__cell"
                data-no-drag
                data-kind={id}
                data-error={cellError ? "true" : "false"}
                aria-label={editMode ? `Configure ${title}` : title}
                title={cellError ?? title}
                onClick={() => activate(id)}
              >
                <span className="shortcut-widget__mark" aria-hidden="true">
                  {shortcutMark(title)}
                </span>
                <span className="shortcut-widget__label">{title}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {configOpen && runtime ? <ShortcutConfig instanceId={instanceId} variant={variant} ids={ids} onClose={() => setConfigOpen(false)} /> : null}
    </section>
  );
}
