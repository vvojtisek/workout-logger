from datetime import date
from unittest.mock import AsyncMock

from app.services.nutrition_dashboard import _get_totals


class AggregateResult:
    def one(self) -> tuple[float, float, float, float, float | None]:
        return 120.0, 20.0, 15.0, 4.0, None


async def test_daily_totals_treat_nullable_fiber_aggregate_as_zero():
    session = AsyncMock()
    session.execute.return_value = AggregateResult()

    totals = await _get_totals(session, date(2026, 10, 13))

    assert totals.fiber_g == 0.0
