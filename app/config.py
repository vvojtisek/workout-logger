from functools import lru_cache

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEFAULT_DEMO_VALUES = {
    "replace-with-at-least-32-random-characters",
    "changeme",
    "secret",
}
MIN_API_KEY_LENGTH = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    API_KEY: str
    DATABASE_URL: str = "sqlite+aiosqlite:////data/workout_logger.db"
    APP_ENV: str = "production"
    APP_VERSION: str = "1.0.0"
    LOG_LEVEL: str = "INFO"
    TRUSTED_HOSTS: str = "localhost,127.0.0.1"
    PUBLIC_BASE_URL: str | None = None

    # --- Invite-only accounts (no SMTP; admin-issued single-use links) ---
    PASSWORD_MIN_LENGTH: int = 12
    INVITE_TTL_HOURS: int = 72
    PASSWORD_RESET_TTL_HOURS: int = 72

    # --- MCP OAuth 2.1 (ChatGPT / MCP clients only; REST keeps X-API-Key) ---
    MCP_OAUTH_ENABLED: bool = False
    # "auth0" (default): FastMCP's OAuthProxy bridging Auth0 for MCP clients
    # that only support Dynamic Client Registration (e.g. ChatGPT).
    # "jwt": a plain resource-server JWT verifier against a known issuer's
    # JWKS. No client-registration bridging; useful for issuers that already
    # support public-client DCR/PKCE directly, and for automated tests.
    MCP_OAUTH_PROVIDER: str = "auth0"
    MCP_OAUTH_ISSUER: str | None = None
    MCP_OAUTH_CLIENT_ID: str | None = None
    MCP_OAUTH_CLIENT_SECRET: str | None = None
    MCP_OAUTH_AUDIENCE: str | None = None
    MCP_OAUTH_BASE_URL: str | None = None
    MCP_OAUTH_ALLOWED_SUBJECTS: str = ""
    MCP_OAUTH_JWT_SIGNING_KEY: str | None = None
    MCP_OAUTH_STORAGE_DIR: str = "/data/mcp-oauth"
    MCP_OAUTH_STORAGE_KEY: str | None = None
    # Only used when MCP_OAUTH_PROVIDER="jwt".
    MCP_OAUTH_JWKS_URI: str | None = None
    MCP_OAUTH_JWT_PUBLIC_KEY: str | None = None

    @field_validator("API_KEY")
    @classmethod
    def validate_api_key(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("API_KEY must not be empty")
        if value.strip().lower() in _DEFAULT_DEMO_VALUES:
            raise ValueError("API_KEY must not use a default demonstration value")
        if len(value) < MIN_API_KEY_LENGTH:
            raise ValueError(f"API_KEY must be at least {MIN_API_KEY_LENGTH} characters")
        return value

    @field_validator("PUBLIC_BASE_URL")
    @classmethod
    def normalize_public_base_url(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        return value.strip().rstrip("/")

    @property
    def trusted_hosts_list(self) -> list[str]:
        return [h.strip() for h in self.TRUSTED_HOSTS.split(",") if h.strip()]

    @property
    def mcp_oauth_allowed_subjects_set(self) -> set[str]:
        return {s.strip() for s in self.MCP_OAUTH_ALLOWED_SUBJECTS.split(",") if s.strip()}

    @property
    def mcp_oauth_base_url_resolved(self) -> str:
        base = self.MCP_OAUTH_BASE_URL or self.PUBLIC_BASE_URL
        if not base:
            raise ValueError(
                "MCP_OAUTH_BASE_URL or PUBLIC_BASE_URL must be set when MCP_OAUTH_ENABLED=true"
            )
        return base.rstrip("/")

    @model_validator(mode="after")
    def _validate_mcp_oauth(self) -> "Settings":
        if not self.MCP_OAUTH_ENABLED:
            return self
        if not self.mcp_oauth_allowed_subjects_set:
            raise ValueError(
                "MCP_OAUTH_ALLOWED_SUBJECTS must list at least one allowed subject "
                "when MCP_OAUTH_ENABLED=true"
            )
        if not (self.MCP_OAUTH_BASE_URL or self.PUBLIC_BASE_URL):
            raise ValueError(
                "MCP_OAUTH_BASE_URL or PUBLIC_BASE_URL must be set when MCP_OAUTH_ENABLED=true"
            )
        if self.MCP_OAUTH_PROVIDER == "auth0":
            missing = [
                name
                for name, value in (
                    ("MCP_OAUTH_ISSUER", self.MCP_OAUTH_ISSUER),
                    ("MCP_OAUTH_CLIENT_ID", self.MCP_OAUTH_CLIENT_ID),
                    ("MCP_OAUTH_CLIENT_SECRET", self.MCP_OAUTH_CLIENT_SECRET),
                    ("MCP_OAUTH_AUDIENCE", self.MCP_OAUTH_AUDIENCE),
                )
                if not value
            ]
            if missing:
                raise ValueError("MCP_OAUTH_PROVIDER=auth0 requires " + ", ".join(missing))
        elif self.MCP_OAUTH_PROVIDER == "jwt":
            if not self.MCP_OAUTH_ISSUER or not self.MCP_OAUTH_AUDIENCE:
                raise ValueError(
                    "MCP_OAUTH_PROVIDER=jwt requires MCP_OAUTH_ISSUER and MCP_OAUTH_AUDIENCE"
                )
            if not self.MCP_OAUTH_JWKS_URI and not self.MCP_OAUTH_JWT_PUBLIC_KEY:
                raise ValueError(
                    "MCP_OAUTH_PROVIDER=jwt requires MCP_OAUTH_JWKS_URI or MCP_OAUTH_JWT_PUBLIC_KEY"
                )
        else:
            raise ValueError(
                f"Unknown MCP_OAUTH_PROVIDER {self.MCP_OAUTH_PROVIDER!r}; expected 'auth0' or 'jwt'"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # fields load from env/.env at runtime
