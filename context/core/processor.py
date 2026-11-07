from context.core.models import ContextSnapshot


class ContextProcessor:
    """Reserved for local normalisation.

    This class does not call a language model. Suggestions are decided later
    by the dashboard bridge, from the snapshot this package already stores.
    """

    def observe(self, snapshot: ContextSnapshot) -> ContextSnapshot:
        return snapshot
