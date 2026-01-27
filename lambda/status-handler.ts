import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { queryAllAmiStates, AmiState, AmiStatus } from "./lib/ami-state";

/**
 * Overall system status derived from preset statuses.
 */
type SystemStatus = "ready" | "building" | "degraded";

/**
 * Status API response format.
 */
interface StatusResponse {
  status: SystemStatus;
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

/**
 * Aggregate preset statuses into overall system status.
 */
function aggregateStatus(presets: AmiState[]): SystemStatus {
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
function generateMessage(presets: AmiState[], status: SystemStatus): string {
  if (presets.length === 0) {
    return "No presets configured";
  }

  const readyCount = presets.filter((p) => p.status === "ready" && p.amiId !== null).length;
  const buildingCount = presets.filter((p) => p.status === "building").length;
  const failedCount = presets.filter((p) => p.status === "failed").length;
  // Exclude building and failed presets from noAmiCount to avoid redundant messages
  const noAmiCount = presets.filter(
    (p) => p.amiId === null && p.status !== "building" && p.status !== "failed"
  ).length;

  if (status === "ready") {
    return presets.length === 1 ? "All presets ready" : `All ${presets.length} presets ready`;
  }

  const parts: string[] = [];

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
    // Query all AMI state records
    const amiStates = await queryAllAmiStates();

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
    const status = aggregateStatus(amiStates);
    const message = generateMessage(amiStates, status);

    const response: StatusResponse = {
      status,
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
