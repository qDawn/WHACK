type WorkspaceProps = {
  onAdd: () => void;
};

export default function Workspace({ onAdd }: WorkspaceProps) {
  return (
    <section className="workspace" data-region="workspace" aria-label="Workspace">
      <div className="workspace__prompt glass-panel">
        <p className="workspace__text">Add a widget to get started.</p>
        <button type="button" className="workspace__add" aria-label="Add a widget" onClick={onAdd}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
            <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </section>
  );
}
