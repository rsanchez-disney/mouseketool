import { Router } from "express";
import {
  ListTablesCommand, DescribeTableCommand, CreateTableCommand,
  UpdateTableCommand, PutItemCommand,
  KeyType, ScalarAttributeType, StreamViewType,
} from "@aws-sdk/client-dynamodb";
import { getDynamoClient } from "../helpers/dynamo-client.js";
import { formatAwsError } from "../helpers/aws-error.js";

const router = Router();

// GET /api/dynamodb/tables — list all tables with stream info
router.get("/tables", async (_req, res) => {
  try {
    const client = await getDynamoClient();
    const { TableNames = [] } = await client.send(new ListTablesCommand({}));

    const tables = await Promise.all(
      TableNames.map(async (name) => {
        try {
          const { Table } = await client.send(new DescribeTableCommand({ TableName: name }));
          return {
            name: Table!.TableName,
            status: Table!.TableStatus,
            itemCount: Table!.ItemCount ?? 0,
            sizeBytes: Table!.TableSizeBytes ?? 0,
            keySchema: Table!.KeySchema?.map(k => ({
              name: k.AttributeName,
              type: k.KeyType,
            })),
            streamEnabled: Table!.StreamSpecification?.StreamEnabled ?? false,
            streamViewType: Table!.StreamSpecification?.StreamViewType ?? null,
            streamArn: Table!.LatestStreamArn ?? null,
          };
        } catch { return { name, status: "UNKNOWN", streamEnabled: false }; }
      })
    );

    res.json(tables);
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});

// POST /api/dynamodb/tables — create a new table with streams enabled
router.post("/tables", async (req, res) => {
  const { tableName, partitionKey, partitionKeyType = "S", sortKey, sortKeyType = "S" } = req.body;
  if (!tableName || !partitionKey) return res.status(400).json({ error: "tableName and partitionKey are required" });

  try {
    const client = await getDynamoClient();

    const attributeDefinitions = [
      { AttributeName: partitionKey, AttributeType: partitionKeyType as ScalarAttributeType },
    ];
    const keySchema: { AttributeName: string; KeyType: KeyType }[] = [
      { AttributeName: partitionKey, KeyType: KeyType.HASH },
    ];

    if (sortKey) {
      attributeDefinitions.push({ AttributeName: sortKey, AttributeType: sortKeyType as ScalarAttributeType });
      keySchema.push({ AttributeName: sortKey, KeyType: KeyType.RANGE });
    }

    await client.send(new CreateTableCommand({
      TableName: tableName,
      AttributeDefinitions: attributeDefinitions,
      KeySchema: keySchema,
      BillingMode: "PAY_PER_REQUEST",
      StreamSpecification: {
        StreamEnabled: true,
        StreamViewType: StreamViewType.NEW_AND_OLD_IMAGES,
      },
    }));

    res.json({ created: true, tableName });
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});

// POST /api/dynamodb/tables/:name/enable-stream — enable streams on existing table
router.post("/tables/:name/enable-stream", async (req, res) => {
  try {
    const client = await getDynamoClient();
    await client.send(new UpdateTableCommand({
      TableName: req.params.name,
      StreamSpecification: {
        StreamEnabled: true,
        StreamViewType: StreamViewType.NEW_AND_OLD_IMAGES,
      },
    }));
    res.json({ enabled: true, tableName: req.params.name });
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});

// GET /api/dynamodb/tables/:name/describe — get key schema + attribute definitions
router.get("/tables/:name/describe", async (req, res) => {
  try {
    const client = await getDynamoClient();
    const { Table } = await client.send(new DescribeTableCommand({ TableName: req.params.name }));
    const keys = (Table!.KeySchema ?? []).map(k => {
      const attr = Table!.AttributeDefinitions?.find(a => a.AttributeName === k.AttributeName);
      return { name: k.AttributeName!, keyType: k.KeyType!, attributeType: attr?.AttributeType ?? "S" };
    });
    res.json({ tableName: Table!.TableName, keys });
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});

// POST /api/dynamodb/tables/:name/put-item — insert item (accepts plain JSON, converts to DynamoDB format)
router.post("/tables/:name/put-item", async (req, res) => {
  const { item } = req.body;
  if (!item || typeof item !== "object") return res.status(400).json({ error: "item object is required" });

  // Convert plain JSON to DynamoDB AttributeValue format
  function toDynamoValue(v: any): any {
    if (v === null || v === undefined) return { NULL: true };
    if (typeof v === "string") return { S: v };
    if (typeof v === "number") return { N: String(v) };
    if (typeof v === "boolean") return { BOOL: v };
    if (Array.isArray(v)) return { L: v.map(toDynamoValue) };
    if (typeof v === "object") return { M: Object.fromEntries(Object.entries(v).map(([k, val]) => [k, toDynamoValue(val)])) };
    return { S: String(v) };
  }

  try {
    const client = await getDynamoClient();
    const dynamoItem = Object.fromEntries(
      Object.entries(item).map(([k, v]) => [k, toDynamoValue(v)])
    );
    await client.send(new PutItemCommand({ TableName: req.params.name, Item: dynamoItem }));
    res.json({ inserted: true });
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});

export default router;
