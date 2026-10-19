"""Operator command line: ``python -m tableui.ops.cli create-operator``."""

import argparse
import asyncio
import getpass

from tableui.ops.application.operators import create_operator
from tableui.platform.config import get_settings
from tableui.platform.db import Database


async def _create(email: str, name: str) -> None:
    password = getpass.getpass("Password (min 12 chars): ")
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


def main() -> None:
    parser = argparse.ArgumentParser(prog="tableui-ops")
    sub = parser.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create-operator")
    c.add_argument("--email", required=True)
    c.add_argument("--name", required=True)
    args = parser.parse_args()
    if args.cmd == "create-operator":
        asyncio.run(_create(args.email, args.name))


if __name__ == "__main__":
    main()
