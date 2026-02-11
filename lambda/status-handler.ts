import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { queryAllAmiStates, upsertAmiState, AmiState, AmiStatus } from "./lib/ami-state";
import { generateAppJwt, getApiBaseUrl } from "./lib/github-app";
import { updateSsmConfig } from "./lib/ssm-config";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  ImagebuilderClient,
  ListImagePipelinesCommand,
  ListImagePipelineImagesCommand,
  GetImageCommand,
} from "@aws-sdk/client-imagebuilder";

const secretsClient = new SecretsManagerClient({});
const imagebuilderClient = new ImagebuilderClient({});
const PRIVATE_KEY_SECRET_ARN = process.env.PRIVATE_KEY_SECRET_ARN ?? "";
const GITHUB_APP_ID = process.env.GITHUB_APP_ID ?? "";
const GITHUB_SERVER_URL = process.env.GITHUB_SERVER_URL ?? "";

const STALE_BUILDING_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

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
 * Check GitHub connectivity by generating a JWT and calling GET /app.
 * Requires privateKey to have been fetched already.
 */
async function checkGitHubConnectivity(privateKey: string): Promise<GitHubConnectivityStatus> {
  if (cachedGitHubStatus !== null) return cachedGitHubStatus;

  try {
    const jwt = generateAppJwt(GITHUB_APP_ID, privateKey);
    const apiUrl = `${getApiBaseUrl(GITHUB_SERVER_URL)}/app`;

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

// Cache reconciliation so it only runs once per Lambda container
let reconciliationDone = false;

/**
 * Reconcile stale "building" AMI states against actual Image Builder pipeline state.
 * Returns true if any records were updated (caller should re-query DynamoDB).
 */
async function reconcileStaleBuildingPresets(amiStates: AmiState[]): Promise<boolean> {
  if (reconciliationDone) return false;
  reconciliationDone = true;

  const now = Date.now();
  const stalePresets = amiStates.filter(
    (s) => s.status === "building" && (now - new Date(s.updatedAt).getTime()) > STALE_BUILDING_THRESHOLD_MS
  );

  if (stalePresets.length === 0) return false;

  console.log(`Found ${stalePresets.length} stale building preset(s), reconciling...`);
  let anyUpdated = false;

  for (const preset of stalePresets) {
    try {
      const updated = await reconcilePreset(preset);
      if (updated) anyUpdated = true;
    } catch (error) {
      console.error(`Failed to reconcile preset ${preset.presetName}:`, error);
    }
  }

  return anyUpdated;
}

/**
 * Reconcile a single stale preset against Image Builder.
 */
async function reconcilePreset(preset: AmiState): Promise<boolean> {
  const pipelineName = `spot-runner-${preset.presetName}`;
  console.log(`Reconciling preset ${preset.presetName}, looking up pipeline: ${pipelineName}`);

  // Find the pipeline by name
  const pipelinesResponse = await imagebuilderClient.send(
    new ListImagePipelinesCommand({
      filters: [{ name: "name", values: [pipelineName] }],
    })
  );

  const pipeline = pipelinesResponse.imagePipelineList?.[0];
  if (!pipeline?.arn) {
    console.warn(`No pipeline found for preset ${preset.presetName}`);
    return false;
  }

  // Get recent images from this pipeline and sort by dateCreated to find the latest.
  // The API does not guarantee sort order, so we fetch a page and sort client-side.
  const imagesResponse = await imagebuilderClient.send(
    new ListImagePipelineImagesCommand({
      imagePipelineArn: pipeline.arn,
      maxResults: 10,
    })
  );

  const images = imagesResponse.imageSummaryList ?? [];
  if (images.length === 0) {
    console.log(`No images found for pipeline ${pipelineName}`);
    return false;
  }

  // Sort descending by dateCreated to get the most recent image
  images.sort((a, b) => {
    const dateA = a.dateCreated ? new Date(a.dateCreated).getTime() : 0;
    const dateB = b.dateCreated ? new Date(b.dateCreated).getTime() : 0;
    return dateB - dateA;
  });

  const latestImageSummary = images[0];
  if (!latestImageSummary?.arn) {
    console.log(`No images found for pipeline ${pipelineName}`);
    return false;
  }

  console.log(`Pipeline ${pipelineName}: selected image created ${latestImageSummary.dateCreated} (${images.length} images found)`);

  // Get full image details to check state and AMI output
  const imageResponse = await imagebuilderClient.send(
    new GetImageCommand({ imageBuildVersionArn: latestImageSummary.arn })
  );

  const image = imageResponse.image;
  const imageState = image?.state?.status;
  console.log(`Pipeline ${pipelineName} latest image state: ${imageState}`);

  if (imageState === "AVAILABLE") {
    // Build completed — extract AMI and update state
    const outputAmis = image?.outputResources?.amis ?? [];
    const currentRegion = process.env.AWS_REGION;
    const amiInfo = outputAmis.find((a) => a.region === currentRegion) ?? outputAmis[0];

    if (!amiInfo?.image) {
      console.error(`Image AVAILABLE but no AMI found in output for ${preset.presetName}`);
      return false;
    }

    console.log(`Reconciliation: preset ${preset.presetName} is actually ready with AMI ${amiInfo.image}`);
    const updated = await upsertAmiState({
      presetName: preset.presetName,
      amiId: amiInfo.image,
      status: "ready",
      buildId: latestImageSummary.arn,
    });

    if (updated) {
      await updateSsmConfig(preset.presetName, amiInfo.image);
    }
    return updated;
  } else if (imageState === "FAILED" || imageState === "CANCELLED") {
    console.log(`Reconciliation: preset ${preset.presetName} build ${imageState?.toLowerCase()}`);
    return await upsertAmiState({
      presetName: preset.presetName,
      amiId: preset.amiId,
      status: "failed",
      buildId: latestImageSummary.arn,
      errorMessage: `Build ${imageState.toLowerCase()} (detected by reconciliation)`,
    });
  }

  // Still building (BUILDING, TESTING, INTEGRATING, etc.) — leave as-is
  console.log(`Preset ${preset.presetName} is legitimately building (state: ${imageState})`);
  return false;
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
    let [privateKeyConfigured, amiStates] = await Promise.all([
      isPrivateKeyConfigured(),
      queryAllAmiStates(),
    ]);

    // Reconcile stale "building" states against actual Image Builder state
    const reconciled = await reconcileStaleBuildingPresets(amiStates);
    if (reconciled) {
      // Re-query to get corrected states
      amiStates = await queryAllAmiStates();
    }

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
