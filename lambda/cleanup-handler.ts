import {
  EC2Client,
  DescribeInstancesCommand,
  TerminateInstancesCommand,
} from "@aws-sdk/client-ec2";
import {
  queryStaleRunners,
  updateRunnerState,
  RunnerStatus,
} from "./lib/state";

const ec2Client = new EC2Client({});

// Environment variables
const PROVISIONING_TIMEOUT_MINUTES = parseInt(
  process.env.PROVISIONING_TIMEOUT_MINUTES ?? "10",
  10
);
const JOB_TIMEOUT_MINUTES = parseInt(
  process.env.JOB_TIMEOUT_MINUTES ?? "60",
  10
);

/**
 * Scheduled cleanup handler.
 * Runs periodically to:
 * 1. Terminate instances stuck in provisioning
 * 2. Terminate instances that have exceeded job timeout
 * 3. Clean up orphaned DynamoDB records
 */
export async function handler(): Promise<void> {
  console.log("Starting cleanup run");

  const now = new Date();

  // Check for provisioning timeouts
  await cleanupStaleRunners(
    "pending",
    PROVISIONING_TIMEOUT_MINUTES,
    now,
    "provisioning_timeout"
  );
  await cleanupStaleRunners(
    "provisioning",
    PROVISIONING_TIMEOUT_MINUTES,
    now,
    "provisioning_timeout"
  );

  // Check for job timeouts
  await cleanupStaleRunners(
    "running",
    JOB_TIMEOUT_MINUTES,
    now,
    "job_timeout"
  );

  // Clean up orphaned instances (tagged but no DynamoDB record)
  await cleanupOrphanedInstances();

  console.log("Cleanup run complete");
}

async function cleanupStaleRunners(
  status: RunnerStatus,
  timeoutMinutes: number,
  now: Date,
  reason: string
): Promise<void> {
  const cutoff = new Date(now.getTime() - timeoutMinutes * 60 * 1000);
  const cutoffIso = cutoff.toISOString();

  console.log(`Checking for ${status} runners older than ${cutoffIso}`);

  const staleRunners = await queryStaleRunners(status, cutoffIso, 50);

  console.log(`Found ${staleRunners.length} stale ${status} runners`);

  for (const runner of staleRunners) {
    console.log(
      `Cleaning up stale runner: job=${runner.jobId} instance=${runner.instanceId} reason=${reason}`
    );

    try {
      // Terminate the instance if it exists
      if (runner.instanceId) {
        await terminateInstance(runner.instanceId);
      }

      // Update state to timeout/failed
      await updateRunnerState(runner.jobId, {
        status: "timeout",
        errorMessage: `Cleanup: ${reason} after ${timeoutMinutes} minutes`,
      });
    } catch (error) {
      console.error(`Failed to clean up runner ${runner.jobId}:`, error);
    }
  }
}

async function terminateInstance(instanceId: string): Promise<void> {
  try {
    await ec2Client.send(
      new TerminateInstancesCommand({
        InstanceIds: [instanceId],
      })
    );
    console.log(`Terminated instance ${instanceId}`);
  } catch (error) {
    // Instance may already be terminated
    const errorName = (error as { name?: string }).name;
    if (errorName !== "InvalidInstanceID.NotFound") {
      throw error;
    }
    console.log(`Instance ${instanceId} already terminated`);
  }
}

async function cleanupOrphanedInstances(): Promise<void> {
  console.log("Checking for orphaned instances");

  try {
    // Find instances tagged as spot-runners
    const response = await ec2Client.send(
      new DescribeInstancesCommand({
        Filters: [
          {
            Name: "tag-key",
            Values: ["spot-runner:job-id"],
          },
          {
            Name: "instance-state-name",
            Values: ["pending", "running"],
          },
        ],
        MaxResults: 100,
      })
    );

    const orphanedInstances: { instanceId: string; jobId: string }[] = [];

    for (const reservation of response.Reservations ?? []) {
      for (const instance of reservation.Instances ?? []) {
        const instanceId = instance.InstanceId;
        const jobIdTag = instance.Tags?.find(
          (t) => t.Key === "spot-runner:job-id"
        );
        const jobId = jobIdTag?.Value;

        if (!instanceId || !jobId) continue;

        // Check if this instance has a corresponding DynamoDB record
        const { getRunnerState } = await import("./lib/state");
        const state = await getRunnerState(jobId);

        if (!state) {
          console.log(
            `Found orphaned instance ${instanceId} for job ${jobId} (no DynamoDB record)`
          );
          orphanedInstances.push({ instanceId, jobId });
        } else if (state.instanceId !== instanceId) {
          console.log(
            `Found orphaned instance ${instanceId} for job ${jobId} (mismatched instance ID: ${state.instanceId})`
          );
          orphanedInstances.push({ instanceId, jobId });
        }
      }
    }

    // Terminate orphaned instances
    for (const { instanceId, jobId } of orphanedInstances) {
      console.log(`Terminating orphaned instance ${instanceId} (job: ${jobId})`);
      await terminateInstance(instanceId);
    }

    console.log(`Cleaned up ${orphanedInstances.length} orphaned instances`);
  } catch (error) {
    console.error("Error checking for orphaned instances:", error);
  }
}
