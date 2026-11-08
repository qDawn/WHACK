import { diagnosticRows, type ModelDiagnostics } from "../modelDiagnostics";

type ModelDiagnosticsPanelProps = {
  diagnostics: ModelDiagnostics | null;
  onClose: () => void;
};

export default function ModelDiagnosticsPanel({ diagnostics, onClose }: ModelDiagnosticsPanelProps) {
  const rows = diagnosticRows(diagnostics);
  return (
    <div className="model-diagnostics__backdrop" onPointerDown={onClose}>
      <div
        className="model-diagnostics glass-panel"
        role="dialog"
        aria-label="Model diagnostics"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="model-diagnostics__header">
          <h2 className="model-diagnostics__title">Model diagnostics</h2>
          <button type="button" className="model-diagnostics__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <ul className="model-diagnostics__list">
          {rows.map((row) => (
            <li key={row.id} data-stage={row.id} data-status={row.status}>
              <span className="model-diagnostics__label">{row.label}</span>
              <span className="model-diagnostics__status">{row.status}</span>
              {row.detail ? <span className="model-diagnostics__detail">{row.detail}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
