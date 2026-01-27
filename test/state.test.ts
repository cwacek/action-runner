import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";

// Mock the DynamoDB client before importing state module
const ddbMock = mockClient(DynamoDBDocumentClient);

// Set required env vars before importing
process.env.STATE_TABLE_NAME = "test-table";
process.env.TTL_DAYS = "7";

import {
  createRunnerState,
  getRunnerState,
  updateRunnerState,
  deleteRunnerState,
  queryRunnersByStatus,
  queryStaleRunners,
  RunnerState,
} from "../lambda/lib/state";

describe("State Operations", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  describe("createRunnerState", () => {
    test("creates new state record successfully", async () => {
      ddbMock.on(PutCommand).resolves({});

      const result = await createRunnerState({
        jobId: "job-123",
        status: "pending",
        repoFullName: "owner/repo",
        workflowName: "CI",
        labels: ["linux", "x64"],
        runnerConfig: "linux-x64",
      });

      expect(result).toBe(true);

      // Verify the put command was called with correct params
      const calls = ddbMock.commandCalls(PutCommand);
      expect(calls).toHaveLength(1);

      const item = calls[0].args[0].input.Item as RunnerState;
      expect(item.jobId).toBe("job-123");
      expect(item.status).toBe("pending");
      expect(item.repoFullName).toBe("owner/repo");
      expect(item.createdAt).toBeDefined();
      expect(item.updatedAt).toBeDefined();
      expect(item.ttl).toBeGreaterThan(0);
    });

    test("returns false for duplicate job (idempotent)", async () => {
      ddbMock.on(PutCommand).rejects(
        new ConditionalCheckFailedException({
          message: "Condition check failed",
          $metadata: {},
        })
      );

      const result = await createRunnerState({
        jobId: "job-123",
        status: "pending",
        repoFullName: "owner/repo",
        workflowName: "CI",
        labels: ["linux", "x64"],
        runnerConfig: "linux-x64",
      });

      expect(result).toBe(false);
    });

    test("throws on other DynamoDB errors", async () => {
      ddbMock.on(PutCommand).rejects(new Error("Connection failed"));

      await expect(
        createRunnerState({
          jobId: "job-123",
          status: "pending",
          repoFullName: "owner/repo",
          workflowName: "CI",
          labels: ["linux", "x64"],
          runnerConfig: "linux-x64",
        })
      ).rejects.toThrow("Connection failed");
    });
  });

  describe("getRunnerState", () => {
    test("retrieves existing state", async () => {
      const mockState: RunnerState = {
        jobId: "job-123",
        instanceId: "i-abc123",
        status: "running",
        repoFullName: "owner/repo",
        workflowName: "CI",
        labels: ["linux", "x64"],
        runnerConfig: "linux-x64",
        createdAt: "2026-01-27T12:00:00Z",
        updatedAt: "2026-01-27T12:05:00Z",
        ttl: 1234567890,
      };

      ddbMock.on(GetCommand).resolves({ Item: mockState });

      const result = await getRunnerState("job-123");

      expect(result).toEqual(mockState);
    });

    test("returns null for non-existent state", async () => {
      ddbMock.on(GetCommand).resolves({});

      const result = await getRunnerState("non-existent");

      expect(result).toBeNull();
    });
  });

  describe("updateRunnerState", () => {
    test("updates status", async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await updateRunnerState("job-123", { status: "running" });

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(1);

      const input = calls[0].args[0].input;
      expect(input.Key).toEqual({ jobId: "job-123" });
      expect(input.UpdateExpression).toContain("#status = :status");
      expect(input.ExpressionAttributeValues?.[":status"]).toBe("running");
    });

    test("updates instanceId", async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await updateRunnerState("job-123", { instanceId: "i-abc123" });

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(1);

      const input = calls[0].args[0].input;
      expect(input.UpdateExpression).toContain("#instanceId = :instanceId");
      expect(input.ExpressionAttributeValues?.[":instanceId"]).toBe("i-abc123");
    });

    test("updates multiple fields", async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await updateRunnerState("job-123", {
        status: "failed",
        errorMessage: "Spot interrupted",
      });

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(1);

      const input = calls[0].args[0].input;
      expect(input.UpdateExpression).toContain("#status = :status");
      expect(input.UpdateExpression).toContain("#errorMessage = :errorMessage");
    });

    test("always updates updatedAt timestamp", async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await updateRunnerState("job-123", { status: "completed" });

      const calls = ddbMock.commandCalls(UpdateCommand);
      const input = calls[0].args[0].input;
      expect(input.UpdateExpression).toContain("#updatedAt = :updatedAt");
    });
  });

  describe("deleteRunnerState", () => {
    test("deletes state by jobId", async () => {
      ddbMock.on(DeleteCommand).resolves({});

      await deleteRunnerState("job-123");

      const calls = ddbMock.commandCalls(DeleteCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input.Key).toEqual({ jobId: "job-123" });
    });
  });

  describe("queryRunnersByStatus", () => {
    test("queries runners by status", async () => {
      const mockItems: RunnerState[] = [
        {
          jobId: "job-1",
          status: "running",
          repoFullName: "owner/repo1",
          workflowName: "CI",
          labels: ["linux"],
          runnerConfig: "linux-x64",
          createdAt: "2026-01-27T12:00:00Z",
          updatedAt: "2026-01-27T12:00:00Z",
          ttl: 1234567890,
        },
        {
          jobId: "job-2",
          status: "running",
          repoFullName: "owner/repo2",
          workflowName: "CD",
          labels: ["linux"],
          runnerConfig: "linux-x64",
          createdAt: "2026-01-27T12:01:00Z",
          updatedAt: "2026-01-27T12:01:00Z",
          ttl: 1234567890,
        },
      ];

      ddbMock.on(QueryCommand).resolves({ Items: mockItems });

      const result = await queryRunnersByStatus("running");

      expect(result).toHaveLength(2);
      expect(result[0].jobId).toBe("job-1");
      expect(result[1].jobId).toBe("job-2");

      const calls = ddbMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input.IndexName).toBe("status-index");
    });

    test("returns empty array when no matches", async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const result = await queryRunnersByStatus("pending");

      expect(result).toEqual([]);
    });

    test("respects limit parameter", async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      await queryRunnersByStatus("running", 50);

      const calls = ddbMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input.Limit).toBe(50);
    });
  });

  describe("queryStaleRunners", () => {
    test("queries runners older than specified time", async () => {
      const mockItems: RunnerState[] = [
        {
          jobId: "stale-job",
          status: "provisioning",
          repoFullName: "owner/repo",
          workflowName: "CI",
          labels: ["linux"],
          runnerConfig: "linux-x64",
          createdAt: "2026-01-27T10:00:00Z",
          updatedAt: "2026-01-27T10:00:00Z",
          ttl: 1234567890,
        },
      ];

      ddbMock.on(QueryCommand).resolves({ Items: mockItems });

      const result = await queryStaleRunners(
        "provisioning",
        "2026-01-27T12:00:00Z"
      );

      expect(result).toHaveLength(1);
      expect(result[0].jobId).toBe("stale-job");

      const calls = ddbMock.commandCalls(QueryCommand);
      const input = calls[0].args[0].input;
      expect(input.KeyConditionExpression).toContain("#createdAt < :before");
      expect(input.ExpressionAttributeValues?.[":before"]).toBe(
        "2026-01-27T12:00:00Z"
      );
    });
  });
});
