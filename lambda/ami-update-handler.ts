import { EventBridgeEvent } from "aws-lambda";
import { SSMClient, GetParameterCommand, PutParameterCommand } from "@aws-sdk/client-ssm";
import { upsertAmiState, getAmiState } from "./lib/ami-state";

const ssmClient = new SSMClient({});
const CONFIG_PREFIX = process.env.CONFIG_PREFIX ?? "/spot-runner/configs";

/**
 * Image Builder state change event detail structure.
 */
interface ImageBuilderStateChangeDetail {
  "image-build-version-arn": string;
  state: {
    status: "AVAILABLE" | "FAILED" | "CANCELLED";
    reason?: string;
  };
  "output-resources"?: {
    amis?: Array<{
      region: string;
      image: string; // AMI ID
    }>;
  };
}

/**
 * Extract preset name from Image Builder ARN.
 * ARN format: arn:aws:imagebuilder:region:account:image/spot-runner-<preset-name>-<date>/version
 *
 * Pipeline name format: spot-runner-<preset-name>
 * Image name format: spot-runner-<preset-name>-<date>
 */
function extractPresetName(arn: string): string | null {
  // Extract image name from ARN
  const match = arn.match(/image\/([^/]+)\//);
  if (!match) return null;

  const imageName = match[1];

  // Image name format: spot-runner-<preset-name>-<date>
  // We need to extract the preset name between "spot-runner-" and the date suffix
  // Date format is typically YYYY-MM-DD or similar timestamp

  // First try: match spot-runner-<preset>-YYYY-MM-DD pattern
  const datePattern = /^spot-runner-(.+?)-\d{4}-\d{2}-\d{2}/;
  const dateMatch = imageName.match(datePattern);
  if (dateMatch) {
    return dateMatch[1];
  }

  // Second try: match spot-runner-<preset>-<any-timestamp-like-suffix>
  // Timestamp suffixes often contain digits
  const timestampPattern = /^spot-runner-(.+?)-\d+/;
  const timestampMatch = imageName.match(timestampPattern);
  if (timestampMatch) {
    return timestampMatch[1];
  }

  // Third try: if image name starts with spot-runner-, take everything after
  if (imageName.startsWith("spot-runner-")) {
    return imageName.slice("spot-runner-".length);
  }

  // Fallback: use the full image name
  console.warn(`Could not parse preset name from image: ${imageName}`);
  return imageName;
}

/**
 * Update SSM parameter with new AMI ID.
 */
async function updateSsmConfig(presetName: string, amiId: string): Promise<void> {
  const parameterName = `${CONFIG_PREFIX}/${presetName}`;

  // Get current config
  const getResult = await ssmClient.send(
    new GetParameterCommand({ Name: parameterName })
  );

  if (!getResult.Parameter?.Value) {
    console.error(`SSM parameter not found: ${parameterName}`);
    return;
  }

  // Parse, update AMI, and write back
  const config = JSON.parse(getResult.Parameter.Value);
  config.ami = amiId;

  await ssmClient.send(
    new PutParameterCommand({
      Name: parameterName,
      Value: JSON.stringify(config),
      Type: "String",
      Overwrite: true,
    })
  );

  console.log(`Updated SSM parameter ${parameterName} with AMI ${amiId}`);
}

/**
 * Lambda handler for Image Builder state change events.
 */
export async function handler(
  event: EventBridgeEvent<"EC2 Image Builder Image State Change", ImageBuilderStateChangeDetail>
): Promise<void> {
  console.log("Received Image Builder event:", JSON.stringify(event, null, 2));

  const detail = event.detail;
  const buildArn = detail["image-build-version-arn"];
  const status = detail.state.status;

  // Extract preset name from ARN
  const presetName = extractPresetName(buildArn);
  if (!presetName) {
    console.error(`Could not extract preset name from ARN: ${buildArn}`);
    return;
  }

  console.log(`Processing ${status} event for preset: ${presetName}`);

  if (status === "AVAILABLE") {
    // Extract AMI ID from output resources
    const amis = detail["output-resources"]?.amis ?? [];
    const currentRegion = process.env.AWS_REGION;
    const amiInfo = amis.find((a) => a.region === currentRegion) ?? amis[0];

    if (!amiInfo?.image) {
      console.error("No AMI ID found in event output resources");
      return;
    }

    const amiId = amiInfo.image;
    console.log(`Image Builder completed: AMI ${amiId} for preset ${presetName}`);

    // Update DynamoDB state
    const updated = await upsertAmiState({
      presetName,
      amiId,
      status: "ready",
      buildId: buildArn,
    });

    if (updated) {
      // Update SSM parameter with new AMI ID
      await updateSsmConfig(presetName, amiId);
    } else {
      console.log("Skipping SSM update - DynamoDB state not updated (stale event)");
    }
  } else if (status === "FAILED" || status === "CANCELLED") {
    console.log(`Image Builder ${status.toLowerCase()} for preset ${presetName}`);

    // Get current state to preserve existing AMI ID
    const currentState = await getAmiState(presetName);

    // Update DynamoDB state to failed, but preserve existing AMI ID
    await upsertAmiState({
      presetName,
      amiId: currentState?.amiId ?? null,
      status: "failed",
      buildId: buildArn,
      errorMessage: detail.state.reason ?? `Build ${status.toLowerCase()}`,
    });

    // Do NOT update SSM - keep existing working AMI
    console.log("SSM parameter not updated - preserving existing AMI");
  }
}
