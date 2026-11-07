from typing import Any

from context.core.models import ContextSnapshot


def to_state_snapshot(
    snapshot: ContextSnapshot,
    suggestion: dict[str, str] | None = None,
    run_id: str = "live",
    actions: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """AG-UI STATE_SNAPSHOT the HUD renders as dashboard cards."""

    payload: dict[str, Any] = {
        "process": snapshot.process_name,
        "title": snapshot.window_title,
        "clipboardEnabled": snapshot.clipboard_enabled,
        "noteBody": snapshot.note_body,
    }
    if suggestion is not None:
        payload["suggestion"] = suggestion
    if actions is not None:
        payload["actions"] = actions
    return {
        "protocol": "ag-ui",
        "version": "1.0",
        "type": "STATE_SNAPSHOT",
        "runId": run_id,
        "payload": payload,
    }
