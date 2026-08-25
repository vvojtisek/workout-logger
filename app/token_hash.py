import hashlib


def hash_token(raw_token: str) -> str:
    """Hashes an opaque, high-entropy random token (session/API/invite/reset
    tokens -- 256 bits from `secrets.token_urlsafe`) for use as a DB lookup
    key. This is deliberately SHA-256, not a slow password KDF: tokens aren't
    guessable via brute force or dictionaries the way human-chosen passwords
    are, and a slow hash would make every authenticated request pay a KDF
    cost for no security benefit. User passwords go through Argon2id
    instead -- see `app/security_passwords.py`."""
    # codeql[py/weak-sensitive-data-hashing]
    digest = hashlib.sha256(raw_token.encode("utf-8"))  # lgtm[py/weak-sensitive-data-hashing]
    return digest.hexdigest()
