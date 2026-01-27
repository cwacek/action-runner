import * as crypto from "crypto";
import { mockClient } from "aws-sdk-client-mock";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  EC2Client,
  CreateFleetCommand,
  RunInstancesCommand,
} from "@aws-sdk/client-ec2";
import {
  SSMClient,
  GetParameterCommand,
} from "@aws-sdk/client-ssm";

// Mock all clients before imports
const secretsMock = mockClient(SecretsManagerClient);
const ddbMock = mockClient(DynamoDBDocumentClient);
const ec2Mock = mockClient(EC2Client);
const ssmMock = mockClient(SSMClient);

// Mock fetch for GitHub API calls
const originalFetch = global.fetch;
let mockFetchResponses: Map<string, Response> = new Map();

beforeAll(() => {
  global.fetch = jest.fn((url: string | URL | Request) => {
    const urlStr = url.toString();
    for (const [pattern, response] of mockFetchResponses) {
      if (urlStr.includes(pattern)) {
        return Promise.resolve(response.clone());
      }
    }
    return Promise.reject(new Error(`Unmocked fetch: ${urlStr}`));
  }) as jest.Mock;
});

afterAll(() => {
  global.fetch = originalFetch;
});

// Test RSA key pair (DO NOT use in production)
const TEST_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MmFPMmVshCHKbL0q
rHvuJdXPJYx1j5V2xUvuqPSKlLoV1X0oMzh0qlqHjqBGwTDfVhKfZ9y4yZ5S2wKh
qORFX8k3s/0rDrXmlOKEH3sF7K4mdqCVyfgFh3svkUZN0VLydOSLkS8KoT4LOIJ+
fG+JjWCcACEGF9c5aEJ/qk4b5lY6Iur2/bQnMwuH05G5dK0p8vFGBT9y0sC5FJNe
fJqkFvF6V7x3qL3qFvMr4L9bZqTIpOpU3Y8IIOE1+PCQ9K3Cq0lYuN7cVtFNhPOe
MRB9r7xT14RHvn3A6VcWwKySZPfxY9E0l2GUfQIDAQABAoIBAC5RgZ+hBx7xHnFZ
nQmY436CvdrhCvqP6q7Z2KbkVnK4Z+JF4HxlNHwJpUqXZc9Y9+I0l/p6vpHNJ0VD
Gg0oZ1KEbRsOjKblZetQciku6kzWE0eT9ztZkT5S4xWTtX8xmTZXuqN+iL0F+330
f9veRTA+5T4i6VLHg1Tp6X3SKTL+rG6wdDHkNwL2fPIb5dJ8uL8h3Fa7G/9ai/h4
fpZUjau8xzOXlmrNnakPkxO4cDW7Fjwl7qOUAQq5LNMYqNfzMac3fkCk8f3yE5ai
mHr1R1vHPxNkdJjPf5TRdC2G/LiYQ0L8qyL2MJe1XXXhID6q9clljVeNU+cewgPd
lqFRF00CgYEA7V6xbvtFJI0gGTFs3mC3NnF7O8h8NzJ2l+2fx+TQj5DWRj6vis5I
s7jxNzW6hCQu5Y+wYxHi2FxJ0MFGF0PBP5mY0EbaqV1GJPMxhQQPRH2uf7bqfYdU
T6/N8TQ7wYt3JcvvMmp/GnV+qU0QFQXLG2mfsmsn/Dymv1cqhU1cmfsCgYEA4mFg
s5Rlb0Cr+8LhshkLpaqDr5b4sXNH0QemhDPNYayPfi0NTWD4TDlpbJWYfz2iu+F+
E8GI8V3jEBSzjFp7/iWbk0sOfFnFO7bhR9qO4IXxlReYdEElKmSQUfljBmJy8mdX
i7RqdqfxVdJByj6dLPPv7YCOyKokrtdWJKtTwksCgYBbkvnEcYLT8Hc9np0PL8Dq
lRVspeQORPWlE3DpSmj9SpEhLS0RSq7LILQSdNGH1UM7cFO8G5ld/F4rqz2V0MqP
y7CRXQF0fFCw6epbfOq9i6Pgjt5VE8j9QBWWGZN0cUdKPB7+wkBEMHIgMNSfujr8
HWUDxBW0F7x9tFHHqfkH2wKBgQCUxT8jWg2onTBFfswqWf0MxHF73kL2TvM2uLZx
vRZ5jVq8F7D1R7j6VfYDx1IuD7N4e7y5tAZ3WQYB+xvEOhYH7CXj2Y0Q8PNLqC89
HsKaGUc0j4jDe5xKjDZNNrGhJ0sD0gBvcxQveLDVUvcrxk6bLD4wkkfXMGlNmgCj
FQz4bwKBgQCDNgq3TR3MXAyGNN/2VBAnLYxk/IBE3FxRVB6o9cB9A1Nb4wbp59Vq
R4NKAR6AZFXh0hkxOhRGLNdY1xt5rFBaD5ZLU3oR7b7XCF7n8F6tKz2sf1f4rLzE
5zXKLP8DeNsHfJdO8G6k9DPRH0vCQz8hs7lBLs+g5/hElcP9GyX3xg==
-----END RSA PRIVATE KEY-----`;

const WEBHOOK_SECRET = "test-webhook-secret";

// Set environment variables before importing handler
process.env.STATE_TABLE_NAME = "test-table";
process.env.TTL_DAYS = "7";
process.env.GITHUB_APP_ID = "123456";
process.env.GITHUB_SERVER_URL = "https://github.example.com";
process.env.PRIVATE_KEY_SECRET_ARN = "arn:aws:secretsmanager:us-east-1:123456789:secret:private-key";
process.env.WEBHOOK_SECRET_ARN = "arn:aws:secretsmanager:us-east-1:123456789:secret:webhook-secret";
process.env.LAUNCH_TEMPLATE_ID = "lt-12345";
process.env.SUBNET_IDS = "subnet-1,subnet-2";
process.env.SECURITY_GROUP_IDS = "sg-1";
process.env.CONFIG_PREFIX = "/spot-runner/configs";

// Import handler after setting env vars
import { handler } from "../lambda/webhook-handler";

function createSignature(payload: string): string {
  return "sha256=" + crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");
}

function createWorkflowJobPayload(overrides: Partial<{
  action: string;
  jobId: number;
  labels: string[];
  repoFullName: string;
  workflowName: string;
  installationId: number;
}> = {}) {
  return {
    action: overrides.action ?? "queued",
    workflow_job: {
      id: overrides.jobId ?? 12345,
      run_id: 67890,
      workflow_name: overrides.workflowName ?? "CI",
      labels: overrides.labels ?? ["self-hosted", "spotrunner/linux-x64"],
    },
    repository: {
      full_name: overrides.repoFullName ?? "owner/repo",
    },
    installation: {
      id: overrides.installationId ?? 11111,
    },
  };
}

describe("Webhook Handler Integration", () => {
  beforeEach(() => {
    // Reset all mocks
    secretsMock.reset();
    ddbMock.reset();
    ec2Mock.reset();
    ssmMock.reset();
    mockFetchResponses.clear();
    (global.fetch as jest.Mock).mockClear();

    // Setup default secret responses
    secretsMock.on(GetSecretValueCommand, {
      SecretId: process.env.PRIVATE_KEY_SECRET_ARN,
    }).resolves({ SecretString: TEST_PRIVATE_KEY });

    secretsMock.on(GetSecretValueCommand, {
      SecretId: process.env.WEBHOOK_SECRET_ARN,
    }).resolves({ SecretString: WEBHOOK_SECRET });

    // Setup default SSM config response
    ssmMock.on(GetParameterCommand).resolves({
      Parameter: {
        Value: JSON.stringify({
          instanceTypes: ["m5.large", "m5.xlarge"],
          ami: "ami-12345",
          diskSizeGb: 100,
          spotStrategy: "spotPreferred",
          timeout: 3600,
          labels: ["linux", "x64"],
        }),
      },
    });

    // Setup default DynamoDB responses
    ddbMock.on(GetCommand).resolves({}); // No existing state
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});

    // Setup default EC2 response
    ec2Mock.on(CreateFleetCommand).resolves({
      Instances: [{
        InstanceIds: ["i-provisioned123"],
        InstanceType: "m5.large",
        LaunchTemplateAndOverrides: {
          Overrides: {
            AvailabilityZone: "us-east-1a",
          },
        },
      }],
    });

    // Setup default GitHub API responses
    mockFetchResponses.set("app/installations/11111/access_tokens", new Response(
      JSON.stringify({ token: "ghs_test_token", expires_at: "2026-01-27T13:00:00Z" }),
      { status: 201 }
    ));

    mockFetchResponses.set("actions/runners/generate-jitconfig", new Response(
      JSON.stringify({
        runner: { id: 1, name: "test-runner" },
        runner_jit_config: "base64-jit-config",
      }),
      { status: 201 }
    ));
  });

  describe("Signature Validation", () => {
    test("rejects requests with invalid signature", async () => {
      const payload = JSON.stringify(createWorkflowJobPayload());

      const result = await handler({
        body: payload,
        headers: {
          "x-hub-signature-256": "sha256=invalid",
          "x-github-event": "workflow_job",
        },
      } as any);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).error).toBe("Invalid signature");
    });

    test("rejects requests with missing signature", async () => {
      const payload = JSON.stringify(createWorkflowJobPayload());

      const result = await handler({
        body: payload,
        headers: {
          "x-github-event": "workflow_job",
        },
      } as any);

      expect(result.statusCode).toBe(401);
    });
  });

  describe("Event Filtering", () => {
    test("ignores non-workflow_job events", async () => {
      const payload = JSON.stringify(createWorkflowJobPayload());

      const result = await handler({
        body: payload,
        headers: {
          "x-hub-signature-256": createSignature(payload),
          "x-github-event": "push",
        },
      } as any);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe("Event ignored");
    });

    test("ignores non-queued actions", async () => {
      const payload = JSON.stringify(createWorkflowJobPayload({ action: "completed" }));

      const result = await handler({
        body: payload,
        headers: {
          "x-hub-signature-256": createSignature(payload),
          "x-github-event": "workflow_job",
        },
      } as any);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe("Action ignored");
    });

    test("ignores jobs without spotrunner label", async () => {
      const payload = JSON.stringify(createWorkflowJobPayload({
        labels: ["self-hosted", "linux", "x64"],
      }));

      const result = await handler({
        body: payload,
        headers: {
          "x-hub-signature-256": createSignature(payload),
          "x-github-event": "workflow_job",
        },
      } as any);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe("No matching runner config");
    });
  });

  describe("Idempotency", () => {
    test("skips provisioning if job already being handled", async () => {
      // Return existing state
      ddbMock.on(GetCommand).resolves({
        Item: {
          jobId: "12345",
          status: "running",
          instanceId: "i-existing",
        },
      });

      const payload = JSON.stringify(createWorkflowJobPayload());

      const result = await handler({
        body: payload,
        headers: {
          "x-hub-signature-256": createSignature(payload),
          "x-github-event": "workflow_job",
        },
      } as any);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe("Job already being handled");

      // Should not have called EC2
      expect(ec2Mock.commandCalls(CreateFleetCommand)).toHaveLength(0);
    });
  });

  describe("Successful Provisioning", () => {
    test("provisions spot instance for valid workflow_job.queued event", async () => {
      const payload = JSON.stringify(createWorkflowJobPayload());

      const result = await handler({
        body: payload,
        headers: {
          "x-hub-signature-256": createSignature(payload),
          "x-github-event": "workflow_job",
        },
      } as any);

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.message).toBe("Runner provisioned");
      expect(body.instanceId).toBe("i-provisioned123");
      expect(body.instanceType).toBe("m5.large");
      expect(body.isSpot).toBe(true);

      // Verify state updates
      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls.length).toBeGreaterThanOrEqual(2);

      // Should have updated to provisioning, then running
      const statuses = updateCalls.map(
        call => call.args[0].input.ExpressionAttributeValues?.[":status"]
      ).filter(Boolean);
      expect(statuses).toContain("provisioning");
      expect(statuses).toContain("running");
    });

    test("falls back to on-demand when spot fails", async () => {
      // Make spot fail
      ec2Mock.on(CreateFleetCommand).resolves({
        Instances: [],
        Errors: [{ ErrorCode: "InsufficientCapacity" }],
      });

      // On-demand succeeds
      ec2Mock.on(RunInstancesCommand).resolves({
        Instances: [{
          InstanceId: "i-ondemand123",
          Placement: { AvailabilityZone: "us-east-1b" },
        }],
      });

      const payload = JSON.stringify(createWorkflowJobPayload());

      const result = await handler({
        body: payload,
        headers: {
          "x-hub-signature-256": createSignature(payload),
          "x-github-event": "workflow_job",
        },
      } as any);

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.instanceId).toBe("i-ondemand123");
      expect(body.isSpot).toBe(false);
    });
  });

  describe("Error Handling", () => {
    test("updates state to failed on provisioning error", async () => {
      // Make EC2 fail completely
      ec2Mock.on(CreateFleetCommand).rejects(new Error("EC2 error"));
      ec2Mock.on(RunInstancesCommand).rejects(new Error("EC2 error"));

      const payload = JSON.stringify(createWorkflowJobPayload());

      const result = await handler({
        body: payload,
        headers: {
          "x-hub-signature-256": createSignature(payload),
          "x-github-event": "workflow_job",
        },
      } as any);

      expect(result.statusCode).toBe(500);

      // Verify state was updated to failed
      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      const failedUpdate = updateCalls.find(
        call => call.args[0].input.ExpressionAttributeValues?.[":status"] === "failed"
      );
      expect(failedUpdate).toBeDefined();
    });
  });
});
