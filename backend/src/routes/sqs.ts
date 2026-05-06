import { Router } from "express";
import {
  ListQueuesCommand, GetQueueAttributesCommand, CreateQueueCommand, QueueAttributeName,
} from "@aws-sdk/client-sqs";
import { getSqsClient } from "../helpers/sqs-client.js";
import { formatAwsError } from "../helpers/aws-error.js";

const router = Router();

// GET /api/sqs/queues - list all queues with attributes
router.get("/queues", async (_req, res) => {
  try {
    const client = await getSqsClient();
    const { QueueUrls = [] } = await client.send(new ListQueuesCommand({}));

    const queues = await Promise.all(
      QueueUrls.filter(url => { const n = url.split("/").pop()!; return !n.startsWith("mk-relay-") && !n.startsWith("-"); }).map(async (url) => {
        const name = url.split("/").pop()!;
        try {
          const { Attributes = {} } = await client.send(new GetQueueAttributesCommand({
            QueueUrl: url,
            AttributeNames: [QueueAttributeName.All],
          }));
          return {
            name,
            url,
            arn: Attributes.QueueArn ?? null,
            messageCount: parseInt(Attributes.ApproximateNumberOfMessages ?? "0"),
            createdTimestamp: Attributes.CreatedTimestamp ?? null,
          };
        } catch { return { name, url, arn: null, messageCount: 0 }; }
      })
    );

    res.json(queues);
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});

// POST /api/sqs/queues - create a new queue
router.post("/queues", async (req, res) => {
  const { queueName: rawName, createDlq, maxReceiveCount } = req.body;
  const queueName = rawName?.trim();
  if (!queueName) return res.status(400).json({ error: "queueName is required" });

  try {
    const client = await getSqsClient();
    let attributes: Record<string, string> = {};

    if (createDlq) {
      const dlqName = `${queueName}-dlq`;
      const { QueueUrl: dlqUrl } = await client.send(new CreateQueueCommand({ QueueName: dlqName }));
      const { Attributes = {} } = await client.send(new GetQueueAttributesCommand({ QueueUrl: dlqUrl!, AttributeNames: [QueueAttributeName.QueueArn] }));
      attributes.RedrivePolicy = JSON.stringify({ deadLetterTargetArn: Attributes.QueueArn, maxReceiveCount: String(maxReceiveCount || 3) });
    }

    const { QueueUrl } = await client.send(new CreateQueueCommand({ QueueName: queueName, Attributes: Object.keys(attributes).length ? attributes : undefined }));
    res.json({ created: true, queueName, queueUrl: QueueUrl, dlq: createDlq ? `${queueName}-dlq` : null });
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});

export default router;
