// Template Lambda: DynamoDB Stream to SNS Forwarder
// Reads DynamoDB stream records and publishes them to an SNS topic.
// Expects env var: SNS_TOPIC_ARN

const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");

exports.handler = async (event) => {
  const topicArn = process.env.SNS_TOPIC_ARN;
  if (!topicArn) throw new Error("SNS_TOPIC_ARN environment variable not set");

  const sns = new SNSClient({
    endpoint: process.env.AWS_ENDPOINT_URL || process.env.LOCALSTACK_HOSTNAME
      ? `http://${process.env.LOCALSTACK_HOSTNAME}:4566`
      : undefined,
  });

  const results = [];
  const onlyInserts = process.env.STREAM_INSERTS_ONLY === "true";
  for (const record of event.Records) {
    if (onlyInserts && record.eventName !== "INSERT") {
      console.log(`Skipping ${record.eventName} event (STREAM_INSERTS_ONLY=true)`);
      continue;
    }
    console.log("DynamoDB Record:", JSON.stringify(record.dynamodb?.NewImage || record.dynamodb?.Keys || {}));
    // Also log unmarshalled version for readability
    const img = record.dynamodb?.NewImage || {};
    const plain = {};
    for (const [k, v] of Object.entries(img)) {
      const val = v;
      if (val.S) plain[k] = val.S;
      else if (val.N) plain[k] = Number(val.N);
      else if (val.BOOL !== undefined) plain[k] = val.BOOL;
      else plain[k] = val;
    }
    console.log("Item:", JSON.stringify(plain));
    const message = JSON.stringify(plain);

    await sns.send(new PublishCommand({
      TopicArn: topicArn,
      Message: message,
      Subject: `DynamoDB ${record.eventName}`,
    }));
    results.push({ eventName: record.eventName, status: "published" });
  }

  return { statusCode: 200, body: JSON.stringify(results) };
};
