// Test Lambda for integration tests
// Behavior based on the SQS message body:
// - If record contains "force_error": true → throws an error
// - Otherwise → returns success with the processed record
exports.handler = async (event) => {
  const records = event.Records || [];
  const results = [];

  for (const record of records) {
    let body;
    try {
      body = JSON.parse(record.body || "{}");
    } catch {
      body = {};
    }

    // If the SNS wraps the message, unwrap it
    if (body.Message) {
      try { body = JSON.parse(body.Message); } catch {}
    }

    if (body.force_error) {
      throw new Error("Intentional test error: force_error flag set");
    }

    results.push({ status: "processed", pk: body.pk || "unknown" });
  }

  return { statusCode: 200, body: JSON.stringify(results) };
};
