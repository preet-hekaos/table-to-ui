"""Outgoing email port. SMTP adapter talks to Mailpit locally and SES in the cloud."""

import asyncio
import smtplib
from dataclasses import dataclass, field
from email.message import EmailMessage
from typing import Protocol


class Mailer(Protocol):
    async def send(self, *, to: str, subject: str, body: str) -> None: ...


class SmtpMailer:
    def __init__(self, host: str, port: int, sender: str) -> None:
        self._host, self._port, self._sender = host, port, sender

    async def send(self, *, to: str, subject: str, body: str) -> None:
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = self._sender, to, subject
        msg.set_content(body)

        def _send() -> None:
            with smtplib.SMTP(self._host, self._port, timeout=10) as smtp:
                smtp.send_message(msg)

        await asyncio.to_thread(_send)


@dataclass
class InMemoryMailer:
    sent: list[dict[str, str]] = field(default_factory=list)

    async def send(self, *, to: str, subject: str, body: str) -> None:
        self.sent.append({"to": to, "subject": subject, "body": body})
