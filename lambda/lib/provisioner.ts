import {
  EC2Client,
  RunInstancesCommand,
  CreateFleetCommand,
  DescribeSubnetsCommand,
  FleetLaunchTemplateOverridesRequest,
  _InstanceType,
} from "@aws-sdk/client-ec2";
import { RunnerConfig, ResourceRequirements } from "./routing";

const ec2Client = new EC2Client({});

export interface ProvisioningParams {
  jobId: string;
  repoFullName: string;
  workflowName: string;
  labels: string[];
  config: RunnerConfig;
  resources: ResourceRequirements;
  jitConfig: string;
  launchTemplateId: string;
  subnetIds: string[];
  securityGroupIds: string[];
}

export interface ProvisioningResult {
  instanceId: string;
  instanceType: string;
  availabilityZone: string;
  isSpot: boolean;
}

/**
 * Generate user data script for runner bootstrap.
 * Includes IMDSv2 support, spot interruption handling, and timeout watchdog.
 */
export function generateUserData(jitConfig: string, timeout: number): string {
  const script = `#!/bin/bash
set -euo pipefail

# Log everything
exec > >(tee /var/log/runner-bootstrap.log) 2>&1
echo "Starting runner bootstrap at $(date)"

# IMDSv2 helper functions
METADATA_URL="http://169.254.169.254/latest"
get_imds_token() {
  curl -s -X PUT "$METADATA_URL/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600"
}
get_metadata() {
  local token=$(get_imds_token)
  curl -s -H "X-aws-ec2-metadata-token: $token" "$METADATA_URL/$1"
}

INSTANCE_ID=$(get_metadata "meta-data/instance-id")
REGION=$(get_metadata "meta-data/placement/region")
echo "Instance: $INSTANCE_ID in $REGION"

# Install the runner (if not pre-baked in AMI)
RUNNER_DIR="/opt/actions-runner"
if [ ! -f "$RUNNER_DIR/run.sh" ]; then
  mkdir -p "$RUNNER_DIR"
  cd "$RUNNER_DIR"
  RUNNER_VERSION="2.331.0"

  # Hardcoded SHA256 checksums for supply chain security
  RUNNER_SHA256_X64="5fcc01bd546ba5c3f1291c2803658ebd3cedb3836489eda3be357d41bfcf28a7"
  RUNNER_SHA256_ARM64="f5863a211241436186723159a111f352f25d5d22711639761ea24c98caef1a9a"

  ARCH="x64"
  EXPECTED_SHA="\$RUNNER_SHA256_X64"
  if [ "$(uname -m)" = "aarch64" ]; then
    ARCH="arm64"
    EXPECTED_SHA="\$RUNNER_SHA256_ARM64"
  fi

  RUNNER_TAR="actions-runner-linux-\${ARCH}-\${RUNNER_VERSION}.tar.gz"
  RUNNER_URL="https://github.com/actions/runner/releases/download/v\${RUNNER_VERSION}/\${RUNNER_TAR}"

  # Download runner
  curl -sL -o runner.tar.gz "\$RUNNER_URL"

  # Verify SHA256 against hardcoded checksum
  ACTUAL_SHA=\$(sha256sum runner.tar.gz | awk '{print \$1}')
  if [ "\$EXPECTED_SHA" != "\$ACTUAL_SHA" ]; then
    echo "ERROR: SHA256 verification failed!"
    echo "Expected: \$EXPECTED_SHA"
    echo "Actual: \$ACTUAL_SHA"
    rm -f runner.tar.gz
    aws ec2 terminate-instances --instance-ids \$INSTANCE_ID --region \$REGION
    exit 1
  fi
  echo "SHA256 verified successfully"

  tar xzf runner.tar.gz && rm runner.tar.gz
fi

cd "$RUNNER_DIR"

# Write JIT config
echo '${jitConfig}' | base64 -d > .jitconfig

# Spot interruption handler
(
  while true; do
    TOKEN=$(get_imds_token)
    ACTION=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" "$METADATA_URL/meta-data/spot/instance-action" 2>/dev/null || echo "")
    if [ -n "$ACTION" ] && [ "$ACTION" != "404" ]; then
      echo "SPOT INTERRUPTION: $ACTION"
      pkill -TERM -f "Runner.Listener" || true
      sleep 90
      pkill -KILL -f "Runner.Listener" || true
      break
    fi
    sleep 5
  done
) &
SPOT_HANDLER_PID=$!

# Timeout watchdog
TIMEOUT_SECONDS=${timeout}
(
  sleep $TIMEOUT_SECONDS
  echo "TIMEOUT: $TIMEOUT_SECONDS seconds reached"
  pkill -TERM -f "Runner.Listener" || true
  sleep 30
  aws ec2 terminate-instances --instance-ids $INSTANCE_ID --region $REGION
) &
TIMEOUT_PID=$!

# Run the runner
echo "Starting runner..."
./run.sh --jitconfig .jitconfig
RUNNER_EXIT=$?
echo "Runner exited: $RUNNER_EXIT"

# Cleanup
kill $SPOT_HANDLER_PID $TIMEOUT_PID 2>/dev/null || true
rm -f .jitconfig

# Self-terminate
echo "Self-terminating..."
aws ec2 terminate-instances --instance-ids $INSTANCE_ID --region $REGION
`;

  return Buffer.from(script).toString("base64");
}

/**
 * Create instance tags for tracking.
 */
function createTags(params: ProvisioningParams) {
  return [
    { Key: "Name", Value: `spot-runner-${params.jobId}` },
    { Key: "spot-runner:job-id", Value: params.jobId },
    { Key: "spot-runner:repo", Value: params.repoFullName },
    { Key: "spot-runner:workflow", Value: params.workflowName },
    { Key: "spot-runner:labels", Value: params.labels.join(",") },
    { Key: "spot-runner:config", Value: params.config.labels.join(",") },
    {
      Key: "spot-runner:provisioned-at",
      Value: new Date().toISOString(),
    },
  ];
}

/**
 * Select instance types based on config and resource requirements.
 * Filters to types that meet minimum CPU/RAM if specified.
 */
function selectInstanceTypes(
  config: RunnerConfig,
  _resources: ResourceRequirements
): string[] {
  // For now, use all configured instance types
  // TODO: Filter based on CPU/RAM requirements using instance type specs
  return config.instanceTypes;
}

/**
 * Provision a runner instance using EC2 Fleet for spot with fallback.
 */
export async function provisionRunner(
  params: ProvisioningParams
): Promise<ProvisioningResult> {
  const instanceTypes = selectInstanceTypes(params.config, params.resources);
  const tags = createTags(params);
  const userData = generateUserData(
    Buffer.from(params.jitConfig).toString("base64"),
    params.config.timeout
  );

  // Create overrides for each instance type and subnet combination
  // Include ImageId from config to use the preset's AMI
  const overrides: FleetLaunchTemplateOverridesRequest[] = [];
  for (const instanceType of instanceTypes) {
    for (const subnetId of params.subnetIds) {
      overrides.push({
        InstanceType: instanceType as _InstanceType,
        SubnetId: subnetId,
        ImageId: params.config.ami, // Use AMI from preset config
      });
    }
  }

  const spotStrategy = params.config.spotStrategy;

  if (spotStrategy === "onDemandOnly") {
    // Use RunInstances for on-demand only
    return provisionOnDemand(params, instanceTypes[0], userData, tags);
  }

  // Use CreateFleet for spot with optional on-demand fallback
  try {
    const fleetResponse = await ec2Client.send(
      new CreateFleetCommand({
        Type: "instant",
        TargetCapacitySpecification: {
          TotalTargetCapacity: 1,
          DefaultTargetCapacityType:
            spotStrategy === "spotOnly" ? "spot" : "spot",
          OnDemandTargetCapacity: 0,
          SpotTargetCapacity: 1,
        },
        SpotOptions: {
          AllocationStrategy: "capacity-optimized",
          InstanceInterruptionBehavior: "terminate",
        },
        LaunchTemplateConfigs: [
          {
            LaunchTemplateSpecification: {
              LaunchTemplateId: params.launchTemplateId,
              Version: "$Latest",
            },
            Overrides: overrides,
          },
        ],
        TagSpecifications: [
          {
            ResourceType: "instance",
            Tags: tags,
          },
        ],
      })
    );

    const instances = fleetResponse.Instances ?? [];
    if (instances.length > 0 && instances[0].InstanceIds?.[0]) {
      return {
        instanceId: instances[0].InstanceIds[0],
        instanceType: instances[0].InstanceType ?? instanceTypes[0],
        availabilityZone: instances[0].LaunchTemplateAndOverrides?.Overrides
          ?.AvailabilityZone ?? "unknown",
        isSpot: true,
      };
    }

    // Check for errors
    const errors = fleetResponse.Errors ?? [];
    if (errors.length > 0) {
      console.error("Fleet creation errors:", errors);
    }

    // If spot failed and strategy allows fallback, try on-demand
    if (spotStrategy === "spotPreferred") {
      console.log("Spot provisioning failed, falling back to on-demand");
      return provisionOnDemand(params, instanceTypes[0], userData, tags);
    }

    throw new Error("Failed to provision spot instance: no capacity");
  } catch (error) {
    if (spotStrategy === "spotPreferred") {
      console.log("Spot provisioning error, falling back to on-demand:", error);
      return provisionOnDemand(params, instanceTypes[0], userData, tags);
    }
    throw error;
  }
}

/**
 * Provision an on-demand instance directly.
 */
async function provisionOnDemand(
  params: ProvisioningParams,
  instanceType: string,
  userData: string,
  tags: { Key: string; Value: string }[]
): Promise<ProvisioningResult> {
  const response = await ec2Client.send(
    new RunInstancesCommand({
      LaunchTemplate: {
        LaunchTemplateId: params.launchTemplateId,
        Version: "$Latest",
      },
      ImageId: params.config.ami, // Override AMI from preset config
      InstanceType: instanceType as _InstanceType,
      MinCount: 1,
      MaxCount: 1,
      SubnetId: params.subnetIds[0],
      UserData: userData,
      TagSpecifications: [
        {
          ResourceType: "instance",
          Tags: [...tags, { Key: "spot-runner:spot-strategy", Value: "on-demand" }],
        },
      ],
    })
  );

  const instance = response.Instances?.[0];
  if (!instance?.InstanceId) {
    throw new Error("Failed to provision on-demand instance");
  }

  return {
    instanceId: instance.InstanceId,
    instanceType: instanceType,
    availabilityZone: instance.Placement?.AvailabilityZone ?? "unknown",
    isSpot: false,
  };
}

/**
 * Get available subnet IDs across multiple AZs.
 */
export async function getSubnetsForProvisioning(
  subnetIds: string[]
): Promise<{ subnetId: string; availabilityZone: string }[]> {
  const response = await ec2Client.send(
    new DescribeSubnetsCommand({
      SubnetIds: subnetIds,
    })
  );

  return (response.Subnets ?? []).map((s) => ({
    subnetId: s.SubnetId ?? "",
    availabilityZone: s.AvailabilityZone ?? "",
  }));
}
