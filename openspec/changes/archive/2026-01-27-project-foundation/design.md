## Context

GitHub Actions workflows require runners to execute jobs. GitHub-hosted runners are convenient but expensive for high-volume usage and lack customization. Self-hosted runners provide control but require persistent infrastructure—even when idle.

This project creates an event-driven runner system where:
1. A GitHub App receives `workflow_job.queued` webhooks
2. A lightweight handler provisions an EC2 spot instance matching the job's `runs-on` labels
3. The instance registers as a runner, executes the job, then terminates
4. No persistent compute runs when there are no jobs

**Constraints**:
- Must work with GitHub Enterprise Server (not just github.com)
- Must deploy via CDK or CloudFormation for enterprise adoption
- Must handle spot interruptions gracefully
- Must support private networking (VPC) for jobs that access internal resources

## Goals / Non-Goals

**Goals:**
- Zero (or near-zero) cost when no jobs are running
- Sub-2-minute startup time from job queued to runner executing
- Simple deployment: one CDK/CFN stack with minimal required configuration
- Transparent to workflow authors: just change `runs-on` labels
- Support multiple runner configurations via label-based routing
- Handle spot interruptions without failing jobs (where possible)
- Windows runners (Linux-only for v1)

**Non-Goals:**
- Auto-scaling pools of warm runners (defeats zero-cost goal)
- GitHub.com support in v1 (focus on GitHub Enterprise Server)
- GPU instances (can be added later, but not v1)
- Multi-region deployment (single region for v1)

## Decisions

### 1. Webhook Handler: Lambda

**Decision**: Use AWS Lambda for the webhook endpoint.

**Rationale**: Lambda provides true scale-to-zero with sub-second cold starts. The webhook handler is stateless and short-lived—a perfect Lambda use case. Alternatives considered:
- *Fargate*: Higher idle cost, slower cold starts
- *EC2*: Persistent cost, overkill for simple webhook handling
- *API Gateway + Lambda*: Standard pattern, well-understood

### 2. State Management: DynamoDB

**Decision**: Use DynamoDB to track runner state (pending, running, terminating).

**Rationale**: Serverless, pay-per-request, integrates well with Lambda. State includes:
- Job ID → Instance ID mapping
- Runner registration status
- Provisioning timestamps (for timeout handling)

Alternatives considered:
- *S3*: Too slow for state lookups
- *ElastiCache*: Persistent cost, overkill
- *Step Functions*: Good for orchestration but adds complexity

### 3. Spot Strategy: Capacity-Optimized with On-Demand Fallback

**Decision**: Use capacity-optimized spot allocation with automatic fallback to on-demand after N spot failures.

**Rationale**: Capacity-optimized reduces interruption risk vs. lowest-price. Fallback ensures jobs don't get stuck waiting for spot capacity. Configuration options:
- `spotOnly`: Never fall back (cheapest, may delay jobs)
- `spotPreferred`: Fall back after configurable failures (default)
- `onDemandOnly`: Always use on-demand (most expensive, most reliable)

### 4. Runner Registration: Just-in-Time (JIT) Tokens

**Decision**: Use GitHub's JIT runner registration tokens.

**Rationale**: JIT tokens are single-use and short-lived, reducing security exposure. The flow:
1. Webhook triggers Lambda
2. Lambda requests JIT token from GitHub API
3. Lambda passes token to EC2 instance via user data (encrypted)
4. Instance registers, runs job, deregisters, terminates

### 5. Configuration: SSM Parameter Store + Labels

**Decision**: Store runner configurations in SSM Parameter Store, keyed by label combinations.

**Rationale**: SSM is serverless, encrypted, and supports hierarchical keys. Example structure:
```
/action-runner/configs/linux-x64-large → { instanceType: "m5.2xlarge", ... }
/action-runner/configs/linux-arm64 → { instanceType: "m6g.large", ... }
```

Label matching: `runs-on: [self-hosted, linux, x64, large]` → looks up `linux-x64-large` config.

### 6. Networking: VPC Required

**Decision**: Runners always launch in a VPC (user-provided or stack-created).

**Rationale**: Enterprise users need runners to access private resources. Public subnet with auto-assign public IP by default; private subnet option for NAT gateway setups. VPC also enables security groups for restricting runner network access.

### 7. AMI Strategy: EC2 Image Builder + User Customization

**Decision**: Use EC2 Image Builder (defined in CDK) to build runner AMIs; allow users to specify custom AMIs.

**Rationale**: Pre-baked AMI reduces startup time (no need to download runner on boot). EC2 Image Builder is preferred over Packer because:
- **No external tooling**: Users don't need to install Packer separately
- **CDK-native**: Image pipeline is defined alongside infrastructure in the same stack
- **AWS-native features**: Automatic scheduling, versioning, cross-account distribution, audit trails
- **Consistent deployment model**: `cdk deploy` handles everything

The Image Builder pipeline:
1. Starts from Ubuntu 22.04 LTS base (aligns with actions/runner-images)
2. Installs Docker and common build tools
3. Pre-installs GitHub Actions runner with hardcoded SHA256 verification
4. Pre-pulls common Docker images (node, python, golang, etc.)

Users can:
- Use the built-in pipeline with `cdk deploy`
- Provide a custom AMI ID to skip building
- Add custom Image Builder components for additional tooling

## Risks / Trade-offs

**Spot Interruptions** → Mitigation: Use capacity-optimized allocation, implement interruption handler that attempts graceful shutdown and job retry signaling.

**Cold Start Latency** → Mitigation: Lambda cold starts are <1s; EC2 boot is the real latency. Use pre-baked AMIs and optimize user-data scripts.

**GitHub API Rate Limits** → Mitigation: Cache app installation tokens (1hr TTL), implement exponential backoff.

**Runaway Costs from Stuck Instances** → Mitigation: Implement hard timeout (configurable, default 6hr), CloudWatch alarms on instance count and spend.

**Webhook Reliability** → Mitigation: GitHub retries failed webhooks; implement idempotency in Lambda handler using job ID as dedup key.

**Security of JIT Tokens in User Data** → Mitigation: Use encrypted user data, short token TTL, instance profile with minimal permissions.

## Open Questions

1. **Multi-job runners**: Should a single instance handle multiple jobs before terminating? Reduces startup overhead but complicates lifecycle management.

2. **Queuing behavior**: If spot capacity is unavailable and on-demand fallback is disabled, should jobs queue indefinitely or fail after timeout?

3. **Observability**: CloudWatch Logs + Metrics, or should we support external observability (Datadog, etc.) out of the box?

4. **Runner groups**: Should we support GitHub's runner groups for organization-level access control, or keep it simple with repo-level registration?
