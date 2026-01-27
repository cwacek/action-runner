import {
  DynamoDBClient,
  ConditionalCheckFailedException,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.STATE_TABLE_NAME ?? "";
const TTL_DAYS = parseInt(process.env.TTL_DAYS ?? "7", 10);

export type RunnerStatus =
  | "pending"
  | "provisioning"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "interrupted";

export interface RunnerState {
  jobId: string;
  instanceId?: string;
  status: RunnerStatus;
  repoFullName: string;
  workflowName: string;
  labels: string[];
  runnerConfig: string;
  createdAt: string;
  updatedAt: string;
  ttl: number;
  errorMessage?: string;
}

function getTtl(): number {
  return Math.floor(Date.now() / 1000) + TTL_DAYS * 24 * 60 * 60;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Create a new runner state record.
 * Uses conditional write to prevent duplicates (idempotency).
 * Returns true if created, false if already exists.
 */
export async function createRunnerState(
  state: Omit<RunnerState, "createdAt" | "updatedAt" | "ttl">
): Promise<boolean> {
  const now = nowIso();
  const item: RunnerState = {
    ...state,
    createdAt: now,
    updatedAt: now,
    ttl: getTtl(),
  };

  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
        ConditionExpression: "attribute_not_exists(jobId)",
      })
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      // Record already exists - idempotent behavior
      return false;
    }
    throw error;
  }
}

/**
 * Get runner state by job ID.
 */
export async function getRunnerState(
  jobId: string
): Promise<RunnerState | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { jobId },
    })
  );
  return (result.Item as RunnerState) ?? null;
}

/**
 * Update runner state. Only updates specified fields.
 */
export async function updateRunnerState(
  jobId: string,
  updates: Partial<Pick<RunnerState, "instanceId" | "status" | "errorMessage">>
): Promise<void> {
  const updateExpressions: string[] = ["#updatedAt = :updatedAt"];
  const expressionNames: Record<string, string> = { "#updatedAt": "updatedAt" };
  const expressionValues: Record<string, unknown> = { ":updatedAt": nowIso() };

  if (updates.instanceId !== undefined) {
    updateExpressions.push("#instanceId = :instanceId");
    expressionNames["#instanceId"] = "instanceId";
    expressionValues[":instanceId"] = updates.instanceId;
  }

  if (updates.status !== undefined) {
    updateExpressions.push("#status = :status");
    expressionNames["#status"] = "status";
    expressionValues[":status"] = updates.status;
  }

  if (updates.errorMessage !== undefined) {
    updateExpressions.push("#errorMessage = :errorMessage");
    expressionNames["#errorMessage"] = "errorMessage";
    expressionValues[":errorMessage"] = updates.errorMessage;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { jobId },
      UpdateExpression: `SET ${updateExpressions.join(", ")}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues,
    })
  );
}

/**
 * Delete runner state by job ID.
 */
export async function deleteRunnerState(jobId: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { jobId },
    })
  );
}

/**
 * Query runners by status. Used for cleanup operations.
 */
export async function queryRunnersByStatus(
  status: RunnerStatus,
  limit = 100
): Promise<RunnerState[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "status-index",
      KeyConditionExpression: "#status = :status",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":status": status },
      Limit: limit,
    })
  );
  return (result.Items as RunnerState[]) ?? [];
}

/**
 * Query runners created before a certain time with a specific status.
 * Used for timeout detection.
 */
export async function queryStaleRunners(
  status: RunnerStatus,
  beforeIso: string,
  limit = 100
): Promise<RunnerState[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "status-index",
      KeyConditionExpression: "#status = :status AND #createdAt < :before",
      ExpressionAttributeNames: {
        "#status": "status",
        "#createdAt": "createdAt",
      },
      ExpressionAttributeValues: {
        ":status": status,
        ":before": beforeIso,
      },
      Limit: limit,
    })
  );
  return (result.Items as RunnerState[]) ?? [];
}
