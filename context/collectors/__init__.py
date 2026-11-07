from importlib import import_module

_EXPORTS = {
    "ActiveWindowCollector": "active_window",
    "ClipboardCollector": "clipboard",
    "Collector": "base",
    "ProcessCollector": "processes",
    "ScreenCollector": "screen",
    "ScratchpadCollector": "scratchpad",
}

__all__ = list(_EXPORTS)


def __getattr__(name: str):
    module_name = _EXPORTS.get(name)
    if module_name is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    value = getattr(import_module(f"{__name__}.{module_name}"), name)
    globals()[name] = value
    return value
