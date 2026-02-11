import { EventBridgeEvent } from "aws-lambda";
import { ImagebuilderClient, GetImageCommand } from "@aws-sdk/client-imagebuilder";
import { upsertAmiState, getAmiState } from "./lib/ami-state";
import { updateSsmConfig } from "./lib/ssm-config";

const imagebuilderClient = new ImagebuilderClient({});

/**
 * Image Builder state change event detail structure.
 * Note: The ARN is in event.resources[0], NOT in the detail object.
 * The detail only contains state information.
 */
interface ImageBuilderStateChangeDetail {
  "image-build-version-arn"?: string;
  state: {
    status: "AVAILABLE" | "FAILED" | "CANCELLED";
    reason?: string;
  };
  "previous-state"?: {
    status: string;
  };
}

/**
 * Extract preset name from Image Builder ARN.
 *
 * ARN formats seen in practice:
 * - arn:aws:imagebuilder:region:account:image/spotrunnerstack-<preset>/version/build
 *   (CDK recipe name: ${stackName}-${presetName}, lowercased in ARN)
 * - arn:aws:imagebuilder:region:account:image/spot-runner-<preset>-<date>/version
 *   (distribution name: spot-runner-${presetName}-{{buildDate}})
 *
 * Strategy: extract image name from ARN, then strip known prefixes.
 * The CDK stack name varies, so we match the pattern: <stackname>-<preset>/version
 */
function extractPresetName(arn: string): string | null {
  // Extract image name from ARN: everything between "image/" and the next "/"
  const match = arn.match(/image\/([^/]+)\//);
  if (!match) return null;

  const imageName = match[1];
  console.log(`Extracting preset name from image name: ${imageName}`);

  // Pattern 1: CDK-generated recipe name "<stackname>-<preset>"
  // The stack name is "spotrunnerstack" (lowercased from SpotRunnerStack)
  // Match: strip everything up to and including "stack-" prefix
  const stackPattern = /stack-(.+)$/i;
  const stackMatch = imageName.match(stackPattern);
  if (stackMatch) {
    return stackMatch[1];
  }

  // Pattern 2: Distribution name "spot-runner-<preset>-<date>"
  const datePattern = /^spot-runner-(.+?)-\d{4}-\d{2}-\d{2}/;
  const dateMatch = imageName.match(datePattern);
  if (dateMatch) {
    return dateMatch[1];
  }

  // Pattern 3: Distribution name "spot-runner-<preset>-<timestamp>"
  const timestampPattern = /^spot-runner-(.+?)-\d+/;
  const timestampMatch = imageName.match(timestampPattern);
  if (timestampMatch) {
    return timestampMatch[1];
  }

  // Pattern 4: Starts with "spot-runner-"
  if (imageName.startsWith("spot-runner-")) {
    return imageName.slice("spot-runner-".length);
  }

  console.warn(`Could not parse preset name from image: ${imageName}`);
  return imageName;
}

/**
 * Lambda handler for Image Builder state change events.
 */
export async function handler(
  event: EventBridgeEvent<"EC2 Image Builder Image State Change", ImageBuilderStateChangeDetail>
): Promise<void> {
  console.log("Received Image Builder event:", JSON.stringify(event, null, 2));

  const detail = event.detail;
  const status = detail.state.status;

  // ARN is in event.resources[0], not in the detail object
  const buildArn = detail["image-build-version-arn"] ?? event.resources?.[0];
  if (!buildArn) {
    console.error("No image ARN found in event detail or resources");
    return;
  }

  console.log(`Image ARN: ${buildArn}`);

  // Extract preset name from ARN
  const presetName = extractPresetName(buildArn);
  if (!presetName) {
    console.error(`Could not extract preset name from ARN: ${buildArn}`);
    return;
  }

  console.log(`Processing ${status} event for preset: ${presetName}`);

  if (status === "AVAILABLE") {
    // Look up the AMI ID via the Image Builder API since the event detail
    // does not include output-resources
    const imageResponse = await imagebuilderClient.send(
      new GetImageCommand({ imageBuildVersionArn: buildArn })
    );

    const outputAmis = imageResponse.image?.outputResources?.amis ?? [];
    const currentRegion = process.env.AWS_REGION;
    const amiInfo = outputAmis.find((a) => a.region === currentRegion) ?? outputAmis[0];

    if (!amiInfo?.image) {
      console.error("No AMI ID found in Image Builder output resources");
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
