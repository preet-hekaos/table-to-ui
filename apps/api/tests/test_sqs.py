import json

from tableui.platform.messaging_sqs import SqsConsumer, SqsPublisher


class FakeSqs:
    def __init__(self) -> None:
        self.queue: list[dict] = []
        self.deleted: list[str] = []

    def send_message(self, QueueUrl, MessageBody):  # noqa: N803
        self.queue.append({"Body": MessageBody, "ReceiptHandle": f"r{len(self.queue)}"})

    def receive_message(self, QueueUrl, MaxNumberOfMessages, WaitTimeSeconds):  # noqa: N803
        return {"Messages": list(self.queue)}

    def delete_message(self, QueueUrl, ReceiptHandle):  # noqa: N803
        self.deleted.append(ReceiptHandle)
        self.queue = [m for m in self.queue if m["ReceiptHandle"] != ReceiptHandle]


async def test_publish_then_consume_deletes_only_after_success() -> None:
    sqs = FakeSqs()
    await SqsPublisher(sqs, "q").publish({"id": 1})
    await SqsPublisher(sqs, "q").publish({"id": 2})
    seen: list[int] = []

    async def handler(e: dict) -> None:
        if e["id"] == 2 and not seen.count(2):
            seen.append(2)
            raise RuntimeError("boom")
        seen.append(e["id"])

    c = SqsConsumer(sqs, "q", handler)
    assert await c.run_once() == 1  # event 2 failed and stays on the queue
    assert [json.loads(m["Body"])["id"] for m in sqs.queue] == [2]
    assert await c.run_once() == 1  # redelivered, now handled
    assert sqs.queue == []
