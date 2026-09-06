"""Create or update a user account (run from the backend directory).

Usage:
    python scripts/create_user.py <username> <password> <ADMIN|INVESTIGATOR|ANALYST>
"""

import os
import sys

# Ensure backend root is on sys.path when executed directly as a script
_backend_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _backend_root not in sys.path:
    sys.path.insert(0, _backend_root)

from app.database import SessionLocal
from app.models.user import User
from app.services import auth


def main() -> None:
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)
    username, password, role = sys.argv[1], sys.argv[2], sys.argv[3].upper()
    if role not in auth.ROLES:
        print(f"Invalid role {role!r}. Choose one of {auth.ROLES}.")
        sys.exit(1)

    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.username == username).first()
        if existing is not None:
            existing.password_hash = auth.hash_password(password)
            existing.role = role
            print(f"Updated existing user {username!r} (role={role}).")
        else:
            db.add(
                User(
                    username=username,
                    password_hash=auth.hash_password(password),
                    role=role,
                    is_active=True,
                )
            )
            print(f"Created user {username!r} (role={role}).")
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    main()
