"""Create the first admin account for a fresh, invite-only deployment.

Refuses to run if any User row already exists -- this is only for
bootstrapping an empty database. Every account after the first is created
via an admin-issued invite (POST /api/v1/invites -> POST /api/v1/auth/invites/accept).
"""

from __future__ import annotations

import argparse
import asyncio
import getpass

from sqlalchemy import func, select

from app.config import get_settings
from app.database import get_session_maker
from app.models import User
from app.security_passwords import hash_password


async def create_first_admin(email: str, password: str) -> str:
    session_maker = get_session_maker()
    async with session_maker() as session:
        existing = await session.scalar(select(func.count()).select_from(User))
        if existing:
            raise SystemExit(
                "Refusing to run: at least one user already exists. "
                "Use the invite flow (POST /api/v1/invites) to create additional accounts."
            )
        normalized_email = email.strip().lower()
        user = User(email=normalized_email, password_hash=hash_password(password), role="admin")
        session.add(user)
        await session.commit()
    return normalized_email


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", help="Prompted for interactively if omitted")
    args = parser.parse_args()

    password = args.password or getpass.getpass("Password: ")
    min_length = get_settings().PASSWORD_MIN_LENGTH
    if len(password) < min_length:
        raise SystemExit(f"Password must be at least {min_length} characters")

    email = asyncio.run(create_first_admin(args.email, password))
    print(f"Created admin account: {email}")


if __name__ == "__main__":
    main()
