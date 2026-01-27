import {
  DynamoDBClient,
  ConditionalCheckFailedException,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.STATE_TABLE_NAME ?? "";

export type AmiStatus = "building" | "ready" | "failed";

export interface AmiState {
  jobId: string; // Format: "AMI#<preset-name>"
  recordType: "AMI";
  presetName: string;
  amiId: string | null;
  status: AmiStatus;
  updatedAt: string;
  buildId?: string;
  errorMessage?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Get the DynamoDB key for an AMI state record.
 */
export function getAmiKey(presetName: string): string {
  return `AMI#${presetName}`;
}

/**
 * Create or update an AMI state record.
 * Uses conditional write to prevent race conditions - only updates if timestamp is newer.
 */
export async function upsertAmiState(
  state: Omit<AmiState, "jobId" | "recordType" | "updatedAt">
): Promise<boolean> {
  const now = nowIso();
  const item: AmiState = {
    jobId: getAmiKey(state.presetName),
    recordType: "AMI",
    presetName: state.presetName,
    amiId: state.amiId,
    status: state.status,
    updatedAt: now,
    buildId: state.buildId,
    errorMessage: state.errorMessage,
  };

  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
        // Only update if record doesn't exist OR if our update is newer
        ConditionExpression:
          "attribute_not_exists(jobId) OR #updatedAt < :newUpdatedAt",
        ExpressionAttributeNames: { "#updatedAt": "updatedAt" },
        ExpressionAttributeValues: { ":newUpdatedAt": now },
      })
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      // A newer update already exists - this is expected in race conditions
      console.log(`Skipping stale update for ${state.presetName}`);
      return false;
    }
    throw error;
  }
}

/**
 * Get AMI state by preset name.
 */
export async function getAmiState(presetName: string): Promise<AmiState | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { jobId: getAmiKey(presetName) },
    })
  );
  return (result.Item as AmiState) ?? null;
}

/**
 * Update AMI state with conditional timestamp check.
 * Only updates if the new timestamp is after the existing one.
 */
export async function updateAmiState(
  presetName: string,
  updates: Partial<Pick<AmiState, "amiId" | "status" | "buildId" | "errorMessage">>
): Promise<boolean> {
  const now = nowIso();
  const updateExpressions: string[] = ["#updatedAt = :updatedAt"];
  const expressionNames: Record<string, string> = { "#updatedAt": "updatedAt" };
  const expressionValues: Record<string, unknown> = { ":updatedAt": now };

  if (updates.amiId !== undefined) {
    updateExpressions.push("#amiId = :amiId");
    expressionNames["#amiId"] = "amiId";
    expressionValues[":amiId"] = updates.amiId;
  }

  if (updates.status !== undefined) {
    updateExpressions.push("#status = :status");
    expressionNames["#status"] = "status";
    expressionValues[":status"] = updates.status;
  }

  if (updates.buildId !== undefined) {
    updateExpressions.push("#buildId = :buildId");
    expressionNames["#buildId"] = "buildId";
    expressionValues[":buildId"] = updates.buildId;
  }

  if (updates.errorMessage !== undefined) {
    updateExpressions.push("#errorMessage = :errorMessage");
    expressionNames["#errorMessage"] = "errorMessage";
    expressionValues[":errorMessage"] = updates.errorMessage;
  }

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { jobId: getAmiKey(presetName) },
        UpdateExpression: `SET ${updateExpressions.join(", ")}`,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: {
          ...expressionValues,
          ":currentUpdatedAt": now,
        },
        // Only update if timestamp is newer (prevents race conditions)
        ConditionExpression:
          "attribute_exists(jobId) AND #updatedAt < :currentUpdatedAt",
      })
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      console.log(`Conditional check failed for ${presetName} - stale update or record doesn't exist`);
      return false;
    }
    throw error;
  }
}

/**
 * Query all AMI state records.
 * Uses the recordType-index GSI to find all AMI records.
 */
export async function queryAllAmiStates(): Promise<AmiState[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "recordType-index",
      KeyConditionExpression: "#recordType = :ami",
      ExpressionAttributeNames: { "#recordType": "recordType" },
      ExpressionAttributeValues: { ":ami": "AMI" },
    })
  );
  return (result.Items as AmiState[]) ?? [];
}
