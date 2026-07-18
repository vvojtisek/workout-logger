from functools import lru_cache

from pydantic import field_validator
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

    @property
    def trusted_hosts_list(self) -> list[str]:
        return [h.strip() for h in self.TRUSTED_HOSTS.split(",") if h.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # fields load from env/.env at runtime
