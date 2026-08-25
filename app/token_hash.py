import hashlib
import hmac

from app.config import get_settings


def hash_token(raw_token: str) -> str:
    """Hashes an opaque, high-entropy random token (session/API/invite/reset
    tokens -- 256 bits from `secrets.token_urlsafe`) for use as a DB lookup
    key. This is deliberately HMAC-SHA256 keyed by `API_KEY`, not a slow
    password KDF: tokens aren't guessable via brute force or dictionaries the
    way human-chosen passwords are, and a slow hash would make every
    authenticated request pay a KDF cost for no security benefit. Keying the
    hash also means a leaked DB alone can't be used to confirm guesses
    against known tokens. User passwords go through Argon2id instead -- see
    `app/security_passwords.py`."""
    key = get_settings().API_KEY.encode("utf-8")
    return hmac.new(key, raw_token.encode("utf-8"), hashlib.sha256).hexdigest()
