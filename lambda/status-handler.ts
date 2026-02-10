import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { queryAllAmiStates, AmiState, AmiStatus } from "./lib/ami-state";
import { generateAppJwt } from "./lib/github-app";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const secretsClient = new SecretsManagerClient({});
const PRIVATE_KEY_SECRET_ARN = process.env.PRIVATE_KEY_SECRET_ARN ?? "";
const GITHUB_APP_ID = process.env.GITHUB_APP_ID ?? "";
const GITHUB_SERVER_URL = process.env.GITHUB_SERVER_URL ?? "";

/**
 * Overall system status derived from preset statuses and configuration.
 */
type SystemStatus = "ready" | "building" | "degraded";

/**
 * GitHub connectivity check result.
 */
type GitHubConnectivityStatusCode = "connected" | "auth_error" | "unreachable" | "error";

interface GitHubConnectivityStatus {
  status: GitHubConnectivityStatusCode;
  message: string;
  appSlug?: string;
}

/**
 * Status API response format.
 */
interface StatusResponse {
  status: SystemStatus;
  configuration: {
    privateKeyConfigured: boolean;
  };
  github: GitHubConnectivityStatus;
  presets: PresetStatus[];
  message: string;
}

/**
 * Individual preset status in the response.
 */
interface PresetStatus {
  name: string;
  status: AmiStatus;
  amiId: string | null;
  updatedAt: string;
}

// Cache the private key check for the Lambda invocation lifetime
let cachedPrivateKeyConfigured: boolean | null = null;

/**
 * Check if the private key secret has been configured (not a placeholder).
 */
async function isPrivateKeyConfigured(): Promise<boolean> {
  if (cachedPrivateKeyConfigured !== null) return cachedPrivateKeyConfigured;

  if (!PRIVATE_KEY_SECRET_ARN) {
    cachedPrivateKeyConfigured = false;
    return false;
  }

  try {
    const response = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: PRIVATE_KEY_SECRET_ARN })
    );
    const value = response.SecretString ?? "";
    cachedPrivateKeyConfigured = value.length > 0 && !value.startsWith("PLACEHOLDER:");
    return cachedPrivateKeyConfigured;
  } catch (error) {
    console.error("Error checking private key secret:", error);
    cachedPrivateKeyConfigured = false;
    return false;
  }
}

// Cache the GitHub connectivity check for the Lambda invocation lifetime
let cachedGitHubStatus: GitHubConnectivityStatus | null = null;

/**
 * Check GitHub connectivity by generating a JWT and calling GET /api/v3/app.
 * Requires privateKey to have been fetched already.
 */
async function checkGitHubConnectivity(privateKey: string): Promise<GitHubConnectivityStatus> {
  if (cachedGitHubStatus !== null) return cachedGitHubStatus;

  try {
    const jwt = generateAppJwt(GITHUB_APP_ID, privateKey);
    const apiUrl = `${GITHUB_SERVER_URL}/api/v3/app`;

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = (await response.json()) as { slug?: string };
      cachedGitHubStatus = {
        status: "connected",
        message: "GitHub API authentication successful",
        appSlug: data.slug,
      };
    } else if (response.status === 401 || response.status === 403) {
      const body = await response.text();
      cachedGitHubStatus = {
        status: "auth_error",
        message: `GitHub API returned ${response.status}: ${body}`,
      };
    } else {
      cachedGitHubStatus = {
        status: "error",
        message: `GitHub API returned unexpected status ${response.status}`,
      };
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    cachedGitHubStatus = {
      status: "unreachable",
      message: `GitHub server unreachable: ${errMsg}`,
    };
  }

  return cachedGitHubStatus;
}

/**
 * Aggregate preset statuses into overall system status.
 */
function aggregateStatus(
  presets: AmiState[],
  privateKeyConfigured: boolean,
  githubStatus: GitHubConnectivityStatus,
): SystemStatus {
  if (!privateKeyConfigured) {
    return "degraded";
  }

  if (githubStatus.status !== "connected") {
    return "degraded";
  }

  if (presets.length === 0) {
    return "degraded";
  }

  const hasBuilding = presets.some((p) => p.status === "building");
  const hasFailed = presets.some((p) => p.status === "failed");
  const hasNoAmi = presets.some((p) => p.amiId === null && p.status !== "building");
  const allReady = presets.every((p) => p.status === "ready" && p.amiId !== null);

  if (allReady) {
    return "ready";
  }

  if (hasBuilding && !hasFailed && !hasNoAmi) {
    return "building";
  }

  return "degraded";
}

/**
 * Generate human-readable status message.
 */
function generateMessage(
  presets: AmiState[],
  status: SystemStatus,
  privateKeyConfigured: boolean,
  githubStatus: GitHubConnectivityStatus,
): string {
  const parts: string[] = [];

  if (!privateKeyConfigured) {
    parts.push("GitHub App private key not configured");
  }

  if (githubStatus.status === "auth_error") {
    parts.push("GitHub API authentication failed");
  } else if (githubStatus.status === "unreachable") {
    parts.push("GitHub server unreachable");
  } else if (githubStatus.status === "error") {
    parts.push("GitHub connectivity check failed");
  }

  if (presets.length === 0) {
    parts.push("No presets configured");
    return parts.join(", ");
  }

  const readyCount = presets.filter((p) => p.status === "ready" && p.amiId !== null).length;
  const buildingCount = presets.filter((p) => p.status === "building").length;
  const failedCount = presets.filter((p) => p.status === "failed").length;
  const noAmiCount = presets.filter(
    (p) => p.amiId === null && p.status !== "building" && p.status !== "failed"
  ).length;

  if (status === "ready") {
    return presets.length === 1 ? "All presets ready" : `All ${presets.length} presets ready`;
  }

  if (buildingCount > 0) {
    parts.push(`${buildingCount} preset${buildingCount > 1 ? "s" : ""} building`);
  }

  if (failedCount > 0) {
    parts.push(`${failedCount} preset${failedCount > 1 ? "s" : ""} failed`);
  }

  if (noAmiCount > 0) {
    parts.push(`${noAmiCount} preset${noAmiCount > 1 ? "s" : ""} without AMI`);
  }

  if (readyCount > 0 && parts.length > 0) {
    parts.unshift(`${readyCount} preset${readyCount > 1 ? "s" : ""} ready`);
  }

  return parts.join(", ");
}

/**
 * Lambda handler for status API endpoint.
 */
export async function handler(
  _event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log("Status API request received");

  try {
    // Check configuration and AMI states in parallel
    const [privateKeyConfigured, amiStates] = await Promise.all([
      isPrivateKeyConfigured(),
      queryAllAmiStates(),
    ]);

    // Check GitHub connectivity (needs the private key value)
    let githubStatus: GitHubConnectivityStatus;
    if (!privateKeyConfigured) {
      githubStatus = {
        status: "error",
        message: "Private key not configured — skipping connectivity check",
      };
    } else {
      // Fetch the private key value for JWT generation
      const secretResponse = await secretsClient.send(
        new GetSecretValueCommand({ SecretId: PRIVATE_KEY_SECRET_ARN })
      );
      githubStatus = await checkGitHubConnectivity(secretResponse.SecretString ?? "");
    }

    // Map to response format
    const presets: PresetStatus[] = amiStates.map((state) => ({
      name: state.presetName,
      status: state.status,
      amiId: state.amiId,
      updatedAt: state.updatedAt,
    }));

    // Sort by preset name for consistent ordering
    presets.sort((a, b) => a.name.localeCompare(b.name));

    // Aggregate status
    const status = aggregateStatus(amiStates, privateKeyConfigured, githubStatus);
    const message = generateMessage(amiStates, status, privateKeyConfigured, githubStatus);

    const response: StatusResponse = {
      status,
      configuration: {
        privateKeyConfigured,
      },
      github: githubStatus,
      presets,
      message,
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
      body: JSON.stringify(response, null, 2),
    };
  } catch (error) {
    console.error("Error fetching status:", error);

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: "error",
        message: "Failed to retrieve status",
      }),
    };
  }
}
