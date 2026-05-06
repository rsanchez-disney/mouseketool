import { Router } from "express";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import {
  ListTablesCommand, DescribeTableCommand, CreateTableCommand,
  UpdateTableCommand, PutItemCommand, ScanCommand,
  KeyType, ScalarAttributeType, StreamViewType,
} from "@aws-sdk/client-dynamodb";
import { getDynamoClient } from "../helpers/dynamo-client.js";
import { formatAwsError } from "../helpers/aws-error.js";
import { SCHEMAS_DIR } from "../config/constants.js";

const router = Router();

// GET /api/dynamodb/tables - list all tables with stream info
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

// POST /api/dynamodb/tables - create a new table with streams enabled
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

// POST /api/dynamodb/tables/:name/enable-stream - enable streams on existing table
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

// GET /api/dynamodb/tables/:name/describe - get key schema + attribute definitions
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

// POST /api/dynamodb/tables/:name/put-item - insert item (accepts plain JSON, converts to DynamoDB format)
// GET /api/dynamodb/tables/:name/count - live item count
router.get("/tables/:name/count", async (req, res) => {
  try {
    const client = await getDynamoClient();
    const { Count = 0 } = await client.send(new ScanCommand({ TableName: req.params.name, Select: "COUNT" }));
    res.json({ count: Count });
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});


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

// POST /api/dynamodb/tables/:name/save-schema - save table schema + optional seed item
router.post("/tables/:name/save-schema", async (req, res) => {
  try {
    const client = await getDynamoClient();
    const { Table } = await client.send(new DescribeTableCommand({ TableName: req.params.name }));
    if (!Table) return res.status(404).json({ error: "Table not found" });
    const schema: any = {
      tableName: Table.TableName,
      keySchema: Table.KeySchema,
      attributeDefinitions: Table.AttributeDefinitions,
      streamEnabled: !!Table.StreamSpecification?.StreamEnabled,
      streamViewType: Table.StreamSpecification?.StreamViewType,
    };
    if (Table.GlobalSecondaryIndexes?.length) {
      schema.globalSecondaryIndexes = Table.GlobalSecondaryIndexes.map(g => ({
        IndexName: g.IndexName, KeySchema: g.KeySchema, Projection: g.Projection,
      }));
    }
    if (Table.LocalSecondaryIndexes?.length) {
      schema.localSecondaryIndexes = Table.LocalSecondaryIndexes.map(l => ({
        IndexName: l.IndexName, KeySchema: l.KeySchema, Projection: l.Projection,
      }));
    }
    if (req.body.seedItem) schema.seedItem = req.body.seedItem;
    mkdirSync(SCHEMAS_DIR, { recursive: true });
    writeFileSync(join(SCHEMAS_DIR, `${Table.TableName}.json`), JSON.stringify(schema, null, 2));
    res.json({ saved: true, tableName: Table.TableName });
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});

// GET /api/dynamodb/schemas - list saved schemas
router.get("/schemas", (_req, res) => {
  mkdirSync(SCHEMAS_DIR, { recursive: true });
  const files = readdirSync(SCHEMAS_DIR).filter(f => f.endsWith(".json"));
  const schemas = files.map(f => {
    const data = JSON.parse(readFileSync(join(SCHEMAS_DIR, f), "utf-8"));
    return { tableName: data.tableName, hasSeed: !!data.seedItem, keySchema: data.keySchema };
  });
  res.json(schemas);
});

// GET /api/dynamodb/schemas/:name - get a saved schema
router.get("/schemas/:name", (req, res) => {
  const file = join(SCHEMAS_DIR, `${req.params.name}.json`);
  if (!existsSync(file)) return res.status(404).json({ error: "Schema not found" });
  res.json(JSON.parse(readFileSync(file, "utf-8")));
});

// POST /api/dynamodb/schemas/:name/restore - create table from saved schema + optional seed
router.post("/schemas/:name/restore", async (req, res) => {
  const file = join(SCHEMAS_DIR, `${req.params.name}.json`);
  if (!existsSync(file)) return res.status(404).json({ error: "Schema not found" });
  const schema = JSON.parse(readFileSync(file, "utf-8"));
  const seedItem = req.body.seedItem ?? schema.seedItem;
  try {
    const client = await getDynamoClient();
    const createParams: any = {
      TableName: schema.tableName,
      KeySchema: schema.keySchema,
      AttributeDefinitions: schema.attributeDefinitions,
      BillingMode: "PAY_PER_REQUEST",
    };
    if (schema.streamEnabled) {
      createParams.StreamSpecification = { StreamEnabled: true, StreamViewType: schema.streamViewType || "NEW_AND_OLD_IMAGES" };
    }
    if (schema.globalSecondaryIndexes?.length) createParams.GlobalSecondaryIndexes = schema.globalSecondaryIndexes;
    if (schema.localSecondaryIndexes?.length) createParams.LocalSecondaryIndexes = schema.localSecondaryIndexes;
    await client.send(new CreateTableCommand(createParams));
    if (seedItem) {
      await client.send(new PutItemCommand({ TableName: schema.tableName, Item: seedItem }));
    }
    res.json({ restored: true, tableName: schema.tableName, seeded: !!seedItem });
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});

// PUT /api/dynamodb/schemas/:name/seed - update seed item for a saved schema
router.put("/schemas/:name/seed", (req, res) => {
  const file = join(SCHEMAS_DIR, `${req.params.name}.json`);
  if (!existsSync(file)) return res.status(404).json({ error: "Schema not found" });
  const schema = JSON.parse(readFileSync(file, "utf-8"));
  schema.seedItem = req.body.seedItem || null;
  writeFileSync(file, JSON.stringify(schema, null, 2));
  res.json({ updated: true });
});


