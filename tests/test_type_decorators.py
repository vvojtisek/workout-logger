import uuid
from datetime import datetime, timezone

from app.models.base import GUID, UTCDateTime


def test_guid_bind_param_accepts_uuid_instance():
    column_type = GUID()
    value = uuid.uuid4()
    assert column_type.process_bind_param(value, None) == str(value)


def test_guid_bind_param_accepts_string_uuid():
    column_type = GUID()
    value = uuid.uuid4()
    assert column_type.process_bind_param(str(value), None) == str(value)


def test_guid_bind_param_none_passthrough():
    assert GUID().process_bind_param(None, None) is None


def test_guid_result_value_none_passthrough():
    assert GUID().process_result_value(None, None) is None


def test_guid_result_value_parses_string():
    value = uuid.uuid4()
    assert GUID().process_result_value(str(value), None) == value


def test_utc_datetime_bind_param_none_passthrough():
    assert UTCDateTime().process_bind_param(None, None) is None


def test_utc_datetime_bind_param_rejects_naive_datetime():
    import pytest

    with pytest.raises(ValueError, match="Naive datetimes"):
        UTCDateTime().process_bind_param(datetime(2026, 1, 1), None)


def test_utc_datetime_bind_param_converts_to_utc():
    from datetime import timedelta

    plus_two = timezone(timedelta(hours=2))
    value = datetime(2026, 1, 1, 10, 0, tzinfo=plus_two)
    result = UTCDateTime().process_bind_param(value, None)
    assert result == datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc)


def test_utc_datetime_result_value_none_passthrough():
    assert UTCDateTime().process_result_value(None, None) is None


def test_utc_datetime_result_value_assumes_utc_when_naive():
    result = UTCDateTime().process_result_value(datetime(2026, 1, 1, 8, 0), None)
    assert result == datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc)


def test_utc_datetime_result_value_normalizes_aware_datetime():
    from datetime import timedelta

    plus_two = timezone(timedelta(hours=2))
    value = datetime(2026, 1, 1, 10, 0, tzinfo=plus_two)
    result = UTCDateTime().process_result_value(value, None)
    assert result == datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc)
