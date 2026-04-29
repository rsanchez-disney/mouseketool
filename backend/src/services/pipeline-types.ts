export type PipelineStepKind = "dynamodb" | "stream-handler" | "sns" | "sqs" | "lambda";
export type TriggerKind = "dynamodb-insert" | "sqs-send" | "sns-publish";
export type LearningSource = "shadow-sns" | "shadow-stream" | "shadow-sqs";

export interface GenerateIntent {
  id: string;
  label: string;
  description: string;
}

export interface HistoryStep {
  id: string;
  label: string;
  icon: string;
  detailField: string;
  dataField: string;
}

export interface PipelineTypeDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  steps: PipelineStepKind[];
  triggerKind: TriggerKind;
  requiresStreamHandler: boolean;
  requiresFilterPolicy: boolean;
  supportsHeavyLoad: boolean;
  heavyLoadLabel?: string;
  aiLearningSource: LearningSource;
  templateLambda?: string;
  generateIntents: GenerateIntent[];
  historySteps: HistoryStep[];
}

export const PIPELINE_TYPES: PipelineTypeDefinition[] = [
  {
    id: "app-pipeline",
    name: "APP Pipeline",
    description: "Full event-driven chain: DynamoDB stream triggers a handler that publishes to SNS, which fans out to SQS, consumed by a target Lambda.",
    icon: "Workflow",
    steps: ["dynamodb", "stream-handler", "sns", "sqs", "lambda"],
    triggerKind: "dynamodb-insert",
    requiresStreamHandler: true,
    requiresFilterPolicy: true,
    supportsHeavyLoad: true,
    heavyLoadLabel: "Increase DynamoDB Stream batch size and window for high-throughput streams",
    aiLearningSource: "shadow-sns",
    templateLambda: "dynamodb-to-sns",
    generateIntents: [
      { id: "success", label: "Passes filter", description: "Generate an item that passes the SNS filter policy" },
      { id: "filtered", label: "Filtered out", description: "Generate an item that gets blocked by the filter policy" },
      { id: "edge", label: "Edge case", description: "Generate an item with boundary values or unusual data" },
    ],
    historySteps: [
      { id: "dynamodb", label: "DynamoDB Insert", icon: "Database", detailField: "tableName", dataField: "item" },
      { id: "handler", label: "Stream Handler", icon: "Zap", detailField: "glueFunctionName", dataField: "handler" },
      { id: "sns", label: "SNS Publish", icon: "Bell", detailField: "topicName", dataField: "sns" },
      { id: "sqs", label: "SQS Deliver", icon: "Inbox", detailField: "queueName", dataField: "sqs" },
      { id: "target", label: "Target Lambda", icon: "Zap", detailField: "targetFunctionName", dataField: "target" },
    ],
  },
  {
    id: "direct-stream",
    name: "Direct Stream Processor",
    description: "DynamoDB stream triggers a Lambda directly. No SNS or SQS in the middle.",
    icon: "Zap",
    steps: ["dynamodb", "lambda"],
    triggerKind: "dynamodb-insert",
    requiresStreamHandler: false,
    requiresFilterPolicy: false,
    supportsHeavyLoad: true,
    heavyLoadLabel: "Increase DynamoDB Stream batch size and window for high-throughput streams",
    aiLearningSource: "shadow-stream",
    generateIntents: [
      { id: "success", label: "Successful item", description: "Generate a realistic item based on the table schema" },
      { id: "error", label: "Error-inducing", description: "Generate an item likely to cause the Lambda to fail" },
    ],
    historySteps: [
      { id: "dynamodb", label: "DynamoDB Insert", icon: "Database", detailField: "tableName", dataField: "item" },
      { id: "target", label: "Target Lambda", icon: "Zap", detailField: "targetFunctionName", dataField: "target" },
    ],
  },
  {
    id: "queue-consumer",
    name: "Queue Consumer",
    description: "SQS queue triggers a Lambda function. Test Lambda functions that consume queue messages.",
    icon: "Inbox",
    steps: ["sqs", "lambda"],
    triggerKind: "sqs-send",
    requiresStreamHandler: false,
    requiresFilterPolicy: false,
    supportsHeavyLoad: true,
    heavyLoadLabel: "Increase SQS batch size for high-throughput queues",
    aiLearningSource: "shadow-sqs",
    generateIntents: [
      { id: "dynamodb-event", label: "DynamoDB stream event", description: "A DynamoDB Streams record as it would arrive from a table change" },
      { id: "s3-event", label: "S3 event", description: "An S3 event notification for object creation or deletion" },
      { id: "sns-notification", label: "SNS notification", description: "An SNS notification message with a nested JSON payload" },
      { id: "custom", label: "Custom JSON", description: "A generic JSON payload for the target Lambda to process" },
      { id: "error", label: "Error-inducing", description: "A malformed message likely to cause the Lambda to fail" },
    ],
    historySteps: [
      { id: "sqs", label: "SQS Send", icon: "Inbox", detailField: "queueName", dataField: "sqs" },
      { id: "target", label: "Target Lambda", icon: "Zap", detailField: "targetFunctionName", dataField: "target" },
    ],
  },
  {
    id: "sns-fanout",
    name: "SNS Fan-out",
    description: "Publish to an SNS topic, deliver to SQS, and trigger a Lambda. Test pub/sub patterns without a DynamoDB source.",
    icon: "Megaphone",
    steps: ["sns", "sqs", "lambda"],
    triggerKind: "sns-publish",
    requiresStreamHandler: false,
    requiresFilterPolicy: true,
    supportsHeavyLoad: false,
    aiLearningSource: "shadow-sns",
    generateIntents: [
      { id: "success", label: "Passes filter", description: "Generate a message that passes the SNS filter policy" },
      { id: "filtered", label: "Filtered out", description: "Generate a message that gets blocked by the filter policy" },
      { id: "error", label: "Error-inducing", description: "Generate a message likely to cause downstream failures" },
    ],
    historySteps: [
      { id: "sns", label: "SNS Publish", icon: "Bell", detailField: "topicName", dataField: "sns" },
      { id: "sqs", label: "SQS Deliver", icon: "Inbox", detailField: "queueName", dataField: "sqs" },
      { id: "target", label: "Target Lambda", icon: "Zap", detailField: "targetFunctionName", dataField: "target" },
    ],
  },
];

export function getPipelineType(id: string): PipelineTypeDefinition | undefined {
  return PIPELINE_TYPES.find(t => t.id === id);
}
