"""SQS adapter for the event ports: publish outbox events, consume them with at-least-once delivery."""

import asyncio
import json
import logging
from typing import Any

import boto3

from tableui.platform.messaging import Event, Handler

log = logging.getLogger("tableui.sqs")


def make_client(region: str, endpoint_url: str | None = None) -> Any:
    return boto3.client("sqs", region_name=region, endpoint_url=endpoint_url)


class SqsPublisher:
    def __init__(self, client: Any, queue_url: str) -> None:
        self._client, self._url = client, queue_url

    async def publish(self, event: Event) -> None:
        await asyncio.to_thread(
            self._client.send_message, QueueUrl=self._url, MessageBody=json.dumps(event)
        )


class SqsConsumer:
    """Long-polls the queue; a message is deleted only after its handler succeeds (retry otherwise, DLQ after max receives)."""

    def __init__(self, client: Any, queue_url: str, handler: Handler) -> None:
        self._client, self._url, self._handler = client, queue_url, handler

    async def run_once(self, wait_seconds: int = 1) -> int:
        resp = await asyncio.to_thread(
            self._client.receive_message,
            QueueUrl=self._url,
            MaxNumberOfMessages=10,
            WaitTimeSeconds=wait_seconds,
        )
        handled = 0
        for m in resp.get("Messages", []):
            try:
                await self._handler(json.loads(m["Body"]))
            except Exception:
                log.exception("event handler failed; message will be retried")
                continue
            await asyncio.to_thread(
                self._client.delete_message, QueueUrl=self._url, ReceiptHandle=m["ReceiptHandle"]
            )
            handled += 1
        return handled

    async def run_forever(self) -> None:
        while True:
            try:
                await self.run_once(wait_seconds=10)
            except Exception:
                log.exception("sqs poll failed")
                await asyncio.sleep(5)
