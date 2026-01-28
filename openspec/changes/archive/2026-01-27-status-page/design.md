## Context

The current architecture has Image Builder and the webhook handler as independent systems:
- Image Builder creates AMIs but doesn't notify anything when complete
- SSM parameters store runner configs with AMI IDs that users must manually update
- Users have no visibility into whether the system is "ready" after deployment

The desired user experience is a simple flow: deploy → check status → ready.

**Current state:**
- `SpotRunnerStackProps.defaultRunnerConfig` defines instance types but AMI is a placeholder
- `RunnerImagePipeline` construct creates Image Builder pipelines but doesn't track outputs
- SSM parameter at `/spot-runner/configs/default` requires manual AMI ID update
- No status endpoint exists

**Constraints:**
- Status endpoint must be unauthenticated (for simple setup checks)
- Must not expose sensitive information (no secrets, no repo names, no job data)
- AMI updates must be automatic - no manual intervention after deployment

## Goals / Non-Goals

**Goals:**
- Single deployment creates a fully functional system (no manual AMI copying)
- Status endpoint shows configuration readiness at a glance
- Image Builder completion automatically updates SSM configs
- Clear "ready" vs "building" vs "not configured" states

**Non-Goals:**
- Real-time build progress (just start/complete states)
- Multiple concurrent AMI versions (latest wins)
- AMI rollback capability (out of scope for v1)
- Authentication on status endpoint (explicitly unauthenticated)

## Decisions

### 1. Runner Presets as First-Class CDK Configuration

**Decision**: Replace `defaultRunnerConfig` with a `presets` array where each preset defines a complete runner configuration including its Image Builder pipeline.

**Rationale**: This couples the AMI definition with the runner config. When you define a preset, you're defining both "how to build the image" and "how to use it". The stack manages both from a single source of truth.

**Alternatives considered:**
- *Keep manual SSM*: Rejected - defeats the goal of automated setup
- *Separate pipeline configs*: Rejected - too easy for config and pipeline to drift

**Example:**
```typescript
presets: [{
  name: "linux-x64",
  instanceTypes: ["m5.large", "m5.xlarge"],
  architecture: "x86_64",
  additionalDockerImages: ["node:20"],
}]
```

### 2. DynamoDB for AMI State Tracking

**Decision**: Store AMI build state in the existing DynamoDB table (new item type) rather than a separate table or SSM.

**Rationale**:
- Reuses existing table (no new resources)
- Supports atomic updates and queries
- Can store build history/timestamps
- Status Lambda can query both runner state and AMI state from one table

**Alternatives considered:**
- *SSM parameters for state*: Rejected - no history, can't query, race conditions on update
- *New DynamoDB table*: Rejected - unnecessary complexity
- *S3 state file*: Rejected - eventual consistency issues

**Schema addition:**
```
PK: "AMI#<preset-name>"
SK: "LATEST"
amiId: "ami-xxx" | null
status: "building" | "ready" | "failed"
updatedAt: ISO timestamp
buildId: Image Builder build ID
```

### 3. EventBridge for Image Builder Events

**Decision**: Use EventBridge rule to capture Image Builder state changes and trigger AMI update Lambda.

**Rationale**: Native AWS integration, no polling required, reliable delivery. Image Builder emits events for pipeline execution state changes.

**Event pattern:**
```json
{
  "source": ["aws.imagebuilder"],
  "detail-type": ["EC2 Image Builder Image State Change"],
  "detail": {
    "state": { "status": ["AVAILABLE"] }
  }
}
```

**Alternatives considered:**
- *Polling*: Rejected - wasteful, adds latency
- *SNS topic*: Rejected - EventBridge is more flexible and direct

### 4. Status Endpoint Design

**Decision**: Add `/status` GET endpoint to existing API Gateway that returns JSON with preset statuses.

**Rationale**: Reuses existing API Gateway, simple JSON response, easy to curl or check in browser.

**Response format:**
```json
{
  "status": "ready" | "building" | "degraded",
  "presets": [
    {
      "name": "linux-x64",
      "status": "ready",
      "amiId": "ami-xxx",
      "updatedAt": "2026-01-27T12:00:00Z"
    }
  ],
  "message": "All presets ready" | "1 preset building" | etc
}
```

**Status logic:**
- `ready`: All presets have valid AMIs
- `building`: At least one preset is building, none failed
- `degraded`: At least one preset failed or has no AMI

### 5. SSM Auto-Update Strategy

**Decision**: When AMI update Lambda runs, it reads the preset config from DynamoDB and writes the complete config (with new AMI ID) to SSM.

**Rationale**: SSM parameter always reflects the latest known-good state. The Lambda owns the SSM write, not the user.

**Flow:**
1. Image Builder completes → EventBridge triggers Lambda
2. Lambda extracts AMI ID from event
3. Lambda updates DynamoDB AMI state
4. Lambda reads preset config, merges AMI ID, writes to SSM
5. Next webhook uses updated SSM config automatically

## Risks / Trade-offs

**Race condition on rapid builds** → Mitigation: DynamoDB conditional writes ensure only newer AMIs update state. Timestamp comparison prevents old build from overwriting newer.

**Image Builder failure leaves system degraded** → Mitigation: Status endpoint clearly shows failed state. Existing AMI continues working. User can manually trigger rebuild.

**No AMI on first deploy** → Mitigation: Status endpoint shows "building" immediately. Webhook handler rejects jobs for presets without ready AMIs (returns 200 because it's responding to an automated endpoint that doesn't care).

**EventBridge delivery failure** → Mitigation: Image Builder events have retry. DynamoDB state can be manually reconciled if needed.

## Open Questions

1. **Should we auto-trigger Image Builder on stack deploy?** Current thinking: yes, via custom resource. But adds deploy time. Perhaps have the imagebuilder on a schedule and have that be triggered immediately but not as "part" of the deploy?

2. **How to handle preset removal?** If user removes a preset from CDK, should we delete the AMI? Current thinking: no, leave orphaned AMIs (user can clean up).

3. **Should status show more detail on building?** Could show "step 3/7" but requires polling Image Builder API. Current thinking: keep it simple (building/ready/failed).

4. **Should instanceTypes be part of the preset spec given the other options provided in a tag in
  the workflow-routing spec?** current thinking: no- there should be "types" but not sizes, since sizes are a different parameter.
