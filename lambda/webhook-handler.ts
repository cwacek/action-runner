import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from "aws-lambda";
import {
  validateWebhookSignature,
  getInstallationIdFromPayload,
  getJitRunnerToken,
  GitHubAppConfig,
} from "./lib/github-app";
import { createRunnerState, getRunnerState, updateRunnerState } from "./lib/state";
import { resolveRunnerConfig } from "./lib/routing";
import { provisionRunner } from "./lib/provisioner";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const secretsClient = new SecretsManagerClient({});

// Environment variables
const GITHUB_APP_ID = process.env.GITHUB_APP_ID ?? "";
const GITHUB_SERVER_URL = process.env.GITHUB_SERVER_URL ?? "";
const PRIVATE_KEY_SECRET_ARN = process.env.PRIVATE_KEY_SECRET_ARN ?? "";
const WEBHOOK_SECRET_ARN = process.env.WEBHOOK_SECRET_ARN ?? "";
const LAUNCH_TEMPLATE_ID = process.env.LAUNCH_TEMPLATE_ID ?? "";
const SUBNET_IDS = (process.env.SUBNET_IDS ?? "").split(",").filter(Boolean);
const SECURITY_GROUP_IDS = (process.env.SECURITY_GROUP_IDS ?? "")
  .split(",")
  .filter(Boolean);

// Cache for secrets
let cachedPrivateKey: string | null = null;
let cachedWebhookSecret: string | null = null;

async function getPrivateKey(): Promise<string> {
  if (cachedPrivateKey) return cachedPrivateKey;

  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: PRIVATE_KEY_SECRET_ARN })
  );
  const value = response.SecretString ?? "";

  if (!value || value.startsWith("PLACEHOLDER:")) {
    throw new PrivateKeyNotConfiguredError();
  }

  cachedPrivateKey = value;
  return cachedPrivateKey;
}

class PrivateKeyNotConfiguredError extends Error {
  constructor() {
    super("GitHub App private key not configured. Upload your private key to the Secrets Manager secret.");
    this.name = "PrivateKeyNotConfiguredError";
  }
}

async function getWebhookSecret(): Promise<string> {
  if (cachedWebhookSecret) return cachedWebhookSecret;

  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: WEBHOOK_SECRET_ARN })
  );
  cachedWebhookSecret = response.SecretString ?? "";
  return cachedWebhookSecret;
}

interface WorkflowJobPayload {
  action: "queued" | "in_progress" | "completed" | "waiting";
  workflow_job: {
    id: number;
    run_id: number;
    workflow_name: string;
    labels: string[];
    runner_id?: number;
    runner_name?: string;
  };
  repository: {
    full_name: string;
  };
  installation?: {
    id: number;
  };
}

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log("Received webhook event");

  try {
    // Decode body if API Gateway base64-encoded it, so we validate the same
    // bytes GitHub signed and parse the correct JSON.
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf-8")
      : event.body ?? "";

    // Validate webhook signature
    const signature = event.headers["x-hub-signature-256"];
    const webhookSecret = await getWebhookSecret();

    console.log("Webhook signature debug:", JSON.stringify({
      isBase64Encoded: event.isBase64Encoded,
      bodyLength: rawBody.length,
      signatureHeader: signature ?? "(missing)",
      secretLength: webhookSecret.length,
      secretPrefix: webhookSecret.substring(0, 4),
      bodyPrefix: rawBody.substring(0, 50),
    }));

    if (!validateWebhookSignature(rawBody, signature, webhookSecret)) {
      console.error("Invalid webhook signature");
      return {
        statusCode: 401,
        body: JSON.stringify({ error: "Invalid signature" }),
      };
    }

    // Parse payload
    const payload = JSON.parse(rawBody || "{}") as WorkflowJobPayload;
    const eventType = event.headers["x-github-event"];

    // Only handle workflow_job events
    if (eventType !== "workflow_job") {
      console.log(`Ignoring event type: ${eventType}`);
      return {
        statusCode: 200,
        body: JSON.stringify({ message: "Event ignored" }),
      };
    }

    // Only handle queued action
    if (payload.action !== "queued") {
      console.log(`Ignoring action: ${payload.action}`);
      return {
        statusCode: 200,
        body: JSON.stringify({ message: "Action ignored" }),
      };
    }

    const jobId = String(payload.workflow_job.id);
    const labels = payload.workflow_job.labels;
    const repoFullName = payload.repository.full_name;
    const workflowName = payload.workflow_job.workflow_name;

    console.log(`Processing job ${jobId} for ${repoFullName}`);

    // Check if we should handle this job (has spotrunner label)
    const routingResult = await resolveRunnerConfig(labels);
    if (!routingResult) {
      console.log(`No matching config for labels: ${labels.join(", ")}`);
      return {
        statusCode: 200,
        body: JSON.stringify({ message: "No matching runner config" }),
      };
    }

    const { config, parsedLabel, resources } = routingResult;

    // Check if AMI is ready (not pending or empty)
    if (!config.ami || config.ami === "pending") {
      console.log(`AMI not ready for preset ${parsedLabel.config} (ami=${config.ami})`);
      return {
        statusCode: 200,
        body: JSON.stringify({ message: "Runner image not yet available" }),
      };
    }

    // Idempotency check - don't provision if already handling this job
    const existingState = await getRunnerState(jobId);
    if (existingState) {
      console.log(`Job ${jobId} already being handled (status: ${existingState.status})`);
      return {
        statusCode: 200,
        body: JSON.stringify({ message: "Job already being handled" }),
      };
    }

    // Create pending state record (idempotent via conditional write)
    const created = await createRunnerState({
      jobId,
      status: "pending",
      repoFullName,
      workflowName,
      labels,
      runnerConfig: parsedLabel.config,
    });

    if (!created) {
      // Another invocation beat us to it
      console.log(`Job ${jobId} already claimed by another handler`);
      return {
        statusCode: 200,
        body: JSON.stringify({ message: "Job already claimed" }),
      };
    }

    try {
      // Get GitHub App config
      const privateKey = await getPrivateKey();
      const installationId = getInstallationIdFromPayload(
        payload as unknown as Record<string, unknown>
      );

      if (!installationId) {
        throw new Error("Missing installation ID in webhook payload");
      }

      const appConfig: GitHubAppConfig = {
        appId: GITHUB_APP_ID,
        privateKey,
        webhookSecret,
        serverUrl: GITHUB_SERVER_URL,
      };

      // Update state to provisioning
      await updateRunnerState(jobId, { status: "provisioning" });

      // Get JIT runner token
      console.log(`Requesting JIT token for ${repoFullName}`);
      const jitResponse = await getJitRunnerToken(
        appConfig,
        installationId,
        repoFullName,
        config.labels
      );

      // Provision the runner
      console.log(`Provisioning runner for job ${jobId}`);
      const result = await provisionRunner({
        jobId,
        repoFullName,
        workflowName,
        labels,
        config,
        resources,
        jitConfig: jitResponse.runner_jit_config,
        launchTemplateId: LAUNCH_TEMPLATE_ID,
        subnetIds: SUBNET_IDS,
        securityGroupIds: SECURITY_GROUP_IDS,
      });

      // Update state with instance ID
      await updateRunnerState(jobId, {
        instanceId: result.instanceId,
        status: "running",
      });

      console.log(
        `Provisioned ${result.isSpot ? "spot" : "on-demand"} instance ${result.instanceId} (${result.instanceType}) in ${result.availabilityZone}`
      );

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "Runner provisioned",
          instanceId: result.instanceId,
          instanceType: result.instanceType,
          isSpot: result.isSpot,
        }),
      };
    } catch (error) {
      // Update state to failed
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await updateRunnerState(jobId, {
        status: "failed",
        errorMessage,
      });

      console.error(`Failed to provision runner for job ${jobId}:`, error);

      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Failed to provision runner" }),
      };
    }
  } catch (error) {
    if (error instanceof PrivateKeyNotConfiguredError) {
      console.error("Private key not configured:", error.message);
      return {
        statusCode: 503,
        body: JSON.stringify({
          error: "Service not configured",
          message: error.message,
        }),
      };
    }

    console.error("Webhook handler error:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
}
