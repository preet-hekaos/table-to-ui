"""Operator command line: ``python -m tableui.ops.cli create-operator``."""

import argparse
import asyncio
import getpass
import sys

from tableui.ops.application.operators import create_operator
from tableui.platform.config import get_settings
from tableui.platform.db import Database


async def _create(email: str, name: str, non_interactive: bool) -> None:
    password = (
        sys.stdin.readline().rstrip("\n")
        if non_interactive
        else getpass.getpass("Password (min 12 chars): ")
    )
    if len(password) < 12:
        raise SystemExit("Password is too short.")
    db = Database(get_settings().database_url)
    try:
        async with db.control() as s:
            out = await create_operator(s, email=email, full_name=name, password=password)
    finally:
        await db.dispose()
    print("Operator created. Add this to an authenticator app:")
    print(out["otpauth_uri"])
    if non_interactive:
        print(f"secret={out['otpauth_uri'].split('secret=')[1].split('&')[0]}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="tableui-ops")
    sub = parser.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create-operator")
    c.add_argument("--email", required=True)
    c.add_argument("--name", required=True)
    c.add_argument(
        "--non-interactive",
        action="store_true",
        help="read the password from stdin (CI and local scripts)",
    )
    args = parser.parse_args()
    if args.cmd == "create-operator":
        asyncio.run(_create(args.email, args.name, args.non_interactive))


if __name__ == "__main__":
    main()
