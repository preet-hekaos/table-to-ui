"""ClamAV over the clamd INSTREAM protocol (the container used locally and in CI)."""

import asyncio
import struct

from tableui.files.domain.scan import Verdict


class ClamdScanner:
    def __init__(self, host: str, port: int = 3310, timeout: float = 30.0) -> None:
        self.host, self.port, self.timeout = host, port, timeout

    async def scan(self, data: bytes) -> Verdict:
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port), self.timeout
            )
            writer.write(b"zINSTREAM\0")
            for i in range(0, len(data), 1 << 16):
                chunk = data[i : i + (1 << 16)]
                writer.write(struct.pack("!L", len(chunk)) + chunk)
            writer.write(struct.pack("!L", 0))
            await writer.drain()
            reply = await asyncio.wait_for(reader.read(4096), self.timeout)
            writer.close()
        except (OSError, TimeoutError):
            return "error"
        text = reply.decode(errors="replace")
        if "FOUND" in text:
            return "infected"
        return "clean" if text.strip("\0\n ").endswith("OK") else "error"
