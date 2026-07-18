import pytest
from pydantic import ValidationError

from app.config import Settings


def test_empty_api_key_rejected():
    with pytest.raises(ValidationError, match="must not be empty"):
        Settings(API_KEY="   ")


def test_default_demo_api_key_rejected():
    with pytest.raises(ValidationError, match="default demonstration value"):
        Settings(API_KEY="replace-with-at-least-32-random-characters")


def test_short_api_key_rejected():
    with pytest.raises(ValidationError, match="at least 32 characters"):
        Settings(API_KEY="too-short")


def test_valid_api_key_accepted():
    settings = Settings(API_KEY="a" * 32)
    assert settings.API_KEY == "a" * 32


def test_trusted_hosts_list_parses_and_strips():
    settings = Settings(API_KEY="a" * 32, TRUSTED_HOSTS=" localhost , 127.0.0.1 ,")
    assert settings.trusted_hosts_list == ["localhost", "127.0.0.1"]
