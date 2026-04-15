import { Router } from "express";
import { ListTopicsCommand, CreateTopicCommand, SubscribeCommand, ListSubscriptionsByTopicCommand } from "@aws-sdk/client-sns";
import { getSnsClient } from "../helpers/sns-client.js";
import { formatAwsError } from "../helpers/aws-error.js";

const router = Router();

// GET /api/sns/topics
router.get("/topics", async (_req, res) => {
  try {
    const client = await getSnsClient();
    const { Topics = [] } = await client.send(new ListTopicsCommand({}));
    res.json(Topics.map(t => ({
      arn: t.TopicArn!,
      name: t.TopicArn!.split(":").pop()!,
    })));
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});

// POST /api/sns/topics
router.post("/topics", async (req, res) => {
  const { topicName } = req.body;
  if (!topicName) return res.status(400).json({ error: "topicName is required" });
  try {
    const client = await getSnsClient();
    const { TopicArn } = await client.send(new CreateTopicCommand({ Name: topicName }));
    res.json({ created: true, topicArn: TopicArn });
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});

// POST /api/sns/subscribe — subscribe SQS queue to SNS topic
router.post("/subscribe", async (req, res) => {
  const { topicArn, queueArn } = req.body;
  if (!topicArn || !queueArn) return res.status(400).json({ error: "topicArn and queueArn are required" });
  try {
    const client = await getSnsClient();
    const { SubscriptionArn } = await client.send(new SubscribeCommand({
      TopicArn: topicArn,
      Protocol: "sqs",
      Endpoint: queueArn,
    }));
    res.json({ subscribed: true, subscriptionArn: SubscriptionArn });
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});

export default router;
