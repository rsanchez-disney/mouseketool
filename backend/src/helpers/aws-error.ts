export function formatAwsError(err: any): string {
  // SDK wraps non-JSON responses (e.g. HTML from a proxy) in a deserialization error
  if (err?.message?.includes("Deserialization error") || err?.message?.includes("is not valid JSON")) {
    const response = err?.$response || err?.$metadata;
    const status = response?.httpStatusCode || err?.$metadata?.httpStatusCode;
    if (status) return `LocalStack returned HTTP ${status} (non-JSON response - check if LocalStack is running and reachable)`;
    return "LocalStack returned an invalid response - check if it's running and reachable";
  }
  // ResourceNotFoundException, etc.
  if (err?.name && err?.message) return `${err.name}: ${err.message}`;
  return err?.message || String(err);
}
