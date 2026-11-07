from dataclasses import asdict, dataclass
from typing import Any

from context.core.events import utc_now


@dataclass
class ContextSnapshot:
    """Latest desktop context the dashboard is allowed to see.

    Clipboard text is present only while collection is enabled and the
    clipboard holds text. Screenshots and the process list stay out of this
    object.
    """

    platform: str = "windows"
    clipboard_enabled: bool = True
    clipboard_content_type: str = "empty"
    clipboard_text: str | None = None
    process_name: str = ""
    window_title: str = ""
    note_body: str = ""
    updated_at: str = ""

    def touch(self) -> None:
        self.updated_at = utc_now()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
