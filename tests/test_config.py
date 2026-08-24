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


# The test session's conftest enables MCP OAuth ("jwt" provider) globally so
# the MCP test suite can mint tokens without network access. These tests
# validate the `_validate_mcp_oauth` model validator in isolation, so every
# field it might read is pinned explicitly rather than inherited from the
# ambient test environment.
_BASE_OAUTH_FIELDS: dict[str, object] = {
    "MCP_OAUTH_ISSUER": None,
    "MCP_OAUTH_CLIENT_ID": None,
    "MCP_OAUTH_CLIENT_SECRET": None,
    "MCP_OAUTH_AUDIENCE": None,
    "MCP_OAUTH_BASE_URL": None,
    "MCP_OAUTH_ALLOWED_SUBJECTS": "",
    "MCP_OAUTH_JWKS_URI": None,
    "MCP_OAUTH_JWT_PUBLIC_KEY": None,
}


def test_mcp_oauth_disabled_by_default_needs_no_other_settings():
    settings = Settings(API_KEY="a" * 32, MCP_OAUTH_ENABLED=False, **_BASE_OAUTH_FIELDS)
    assert settings.MCP_OAUTH_ENABLED is False


def test_mcp_oauth_enabled_requires_an_allowlist():
    with pytest.raises(ValidationError, match="MCP_OAUTH_ALLOWED_SUBJECTS"):
        Settings(
            API_KEY="a" * 32,
            PUBLIC_BASE_URL="https://fitness.example.test",
            MCP_OAUTH_ENABLED=True,
            **{
                **_BASE_OAUTH_FIELDS,
                "MCP_OAUTH_ISSUER": "https://tenant.auth0.com",
                "MCP_OAUTH_CLIENT_ID": "client",
                "MCP_OAUTH_CLIENT_SECRET": "secret",
                "MCP_OAUTH_AUDIENCE": "https://fitness.example.test/mcp/",
            },
        )


def test_mcp_oauth_enabled_requires_a_base_url():
    with pytest.raises(ValidationError, match="MCP_OAUTH_BASE_URL or PUBLIC_BASE_URL"):
        Settings(
            API_KEY="a" * 32,
            PUBLIC_BASE_URL=None,
            MCP_OAUTH_ENABLED=True,
            MCP_OAUTH_PROVIDER="auth0",
            **{
                **_BASE_OAUTH_FIELDS,
                "MCP_OAUTH_ALLOWED_SUBJECTS": "auth0|abc123",
                "MCP_OAUTH_ISSUER": "https://tenant.auth0.com",
                "MCP_OAUTH_CLIENT_ID": "client",
                "MCP_OAUTH_CLIENT_SECRET": "secret",
                "MCP_OAUTH_AUDIENCE": "https://fitness.example.test/mcp/",
            },
        )


def test_mcp_oauth_auth0_provider_requires_client_credentials_and_audience():
    with pytest.raises(ValidationError, match="MCP_OAUTH_CLIENT_ID"):
        Settings(
            API_KEY="a" * 32,
            PUBLIC_BASE_URL="https://fitness.example.test",
            MCP_OAUTH_ENABLED=True,
            MCP_OAUTH_PROVIDER="auth0",
            **{
                **_BASE_OAUTH_FIELDS,
                "MCP_OAUTH_ALLOWED_SUBJECTS": "auth0|abc123",
                "MCP_OAUTH_ISSUER": "https://tenant.auth0.com",
            },
        )


def test_mcp_oauth_jwt_provider_requires_a_key_source():
    with pytest.raises(ValidationError, match="MCP_OAUTH_JWKS_URI"):
        Settings(
            API_KEY="a" * 32,
            PUBLIC_BASE_URL="https://fitness.example.test",
            MCP_OAUTH_ENABLED=True,
            MCP_OAUTH_PROVIDER="jwt",
            **{
                **_BASE_OAUTH_FIELDS,
                "MCP_OAUTH_ALLOWED_SUBJECTS": "auth0|abc123",
                "MCP_OAUTH_ISSUER": "https://idp.example.test",
                "MCP_OAUTH_AUDIENCE": "https://fitness.example.test/mcp/",
            },
        )


def test_mcp_oauth_unknown_provider_rejected():
    with pytest.raises(ValidationError, match="Unknown MCP_OAUTH_PROVIDER"):
        Settings(
            API_KEY="a" * 32,
            PUBLIC_BASE_URL="https://fitness.example.test",
            MCP_OAUTH_ENABLED=True,
            MCP_OAUTH_PROVIDER="okta",
            **{**_BASE_OAUTH_FIELDS, "MCP_OAUTH_ALLOWED_SUBJECTS": "auth0|abc123"},
        )


def test_mcp_oauth_allowed_subjects_set_parses_and_strips():
    settings = Settings(API_KEY="a" * 32, MCP_OAUTH_ALLOWED_SUBJECTS=" auth0|a , auth0|b ,")
    assert settings.mcp_oauth_allowed_subjects_set == {"auth0|a", "auth0|b"}


def test_mcp_oauth_valid_auth0_config_accepted():
    settings = Settings(
        API_KEY="a" * 32,
        PUBLIC_BASE_URL="https://fitness.example.test",
        MCP_OAUTH_ENABLED=True,
        MCP_OAUTH_ISSUER="https://tenant.auth0.com",
        MCP_OAUTH_CLIENT_ID="client",
        MCP_OAUTH_CLIENT_SECRET="secret",
        MCP_OAUTH_AUDIENCE="https://fitness.example.test/mcp/",
        MCP_OAUTH_ALLOWED_SUBJECTS="auth0|abc123",
    )
    assert settings.MCP_OAUTH_ENABLED is True
    assert settings.mcp_oauth_base_url_resolved == "https://fitness.example.test"
