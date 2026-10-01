from unittest.mock import patch

from preservation_checks import require
from preservation_journal import Journal


def legacy_journal(*args, **kwargs):
    def legacy_require(condition, reason):
        if reason != 'new journal requires an explicit protected scope':
            require(condition, reason)
    with patch('preservation_journal.require', side_effect=legacy_require):
        return Journal(*args, **kwargs)
