// Shadow Lambda: captures SQS messages for diagnostic replay
// Receives messages from the shadow SQS queue (subscribed to pipeline SNS topics).
// Saves each message body to a file keyed by pipeline ID for later diagnostic use.
// Expects env var: CAPTURES_BUCKET (S3 bucket for storing captures) or uses stdout for LocalStack.

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

exports.handler = async (event) => {
  const topicMap = JSON.parse(process.env.TOPIC_MAP || "{}");
  const endpoint = process.env.AWS_ENDPOINT_URL || (process.env.LOCALSTACK_HOSTNAME ? `http://${process.env.LOCALSTACK_HOSTNAME}:4566` : undefined);
  const bucket = process.env.CAPTURES_BUCKET || "mouseketool-captures";

  const s3 = new S3Client({ endpoint, forcePathStyle: true });

  for (const record of event.Records) {
    try {
      // SQS message body contains the SNS envelope (when RawMessageDelivery is false)
      let snsMessage;
      try { snsMessage = JSON.parse(record.body); } catch { snsMessage = { Message: record.body }; }

      const topicArn = snsMessage.TopicArn || "unknown";
      const pipelineId = topicMap[topicArn] || "unknown";
      const messageBody = snsMessage.Message || record.body;
      const timestamp = Date.now();

      // Build the SQS event shape that the target Lambda would receive
      const capturedPayload = {
        Records: [{
          messageId: record.messageId || `capture-${timestamp}`,
          body: messageBody,
          eventSource: "aws:sqs",
          awsRegion: process.env.AWS_REGION || "us-east-1",
          attributes: record.attributes || {},
          messageAttributes: record.messageAttributes || {},
        }]
      };

      const key = `captures/${pipelineId}/latest.json`;
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(capturedPayload, null, 2),
        ContentType: "application/json",
      }));

      console.log(`Captured message for pipeline ${pipelineId}: ${key}`);
    } catch (err) {
      console.error("Capture failed:", err.message);
    }
  }

  return { statusCode: 200, body: "OK" };
};
