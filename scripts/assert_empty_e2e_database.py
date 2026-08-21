"""Fail unless an ephemeral E2E SQLite database contains no application records."""

import argparse
import sqlite3
from pathlib import Path

APPLICATION_TABLES = (
    "exercise_logs",
    "plan_exercises",
    "session_exercises",
    "set_entries",
    "workout_logs",
    "workout_plans",
    "workout_sessions",
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    args = parser.parse_args()

    with sqlite3.connect(args.database) as connection:
        counts = {
            table: connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            for table in APPLICATION_TABLES
        }
    print(f"E2E cleanup database counts: {counts}")
    if any(counts.values()):
        raise SystemExit("E2E cleanup left application records in SQLite")


if __name__ == "__main__":
    main()
