# Spot Runner

Zero-cost GitHub Actions runners on AWS spot instances for GitHub Enterprise Server.

## Overview

Spot Runner provisions ephemeral EC2 spot instances on-demand when GitHub Actions jobs are queued, then terminates them after completion. This provides:

- **Zero idle cost** - No compute runs when there are no jobs
- **Sub-2-minute startup** - Pre-baked AMIs with runner pre-installed
- **Cost savings** - Spot instances at 60-90% discount vs on-demand
- **Private networking** - Runners launch in your VPC with access to internal resources

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  GitHub         │     │  AWS Lambda      │     │  EC2 Spot       │
│  Enterprise     │────▶│  Webhook Handler │────▶│  Instance       │
│  Server         │     │                  │     │  (Runner)       │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                       │                       │
        │ workflow_job.queued   │ Provision             │ Register + Run
        │                       │                       │
        ▼                       ▼                       ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  GitHub App     │     │  DynamoDB        │     │  Self-terminate │
│  Webhook        │     │  State Table     │     │  on completion  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## Quick Start

### Prerequisites

- AWS account with CDK bootstrapped
- GitHub Enterprise Server with admin access
- Node.js 18+ and npm

### 1. Install dependencies

```bash
git clone <repo-url>
cd spot-runner
npm install
```

### 2. Deploy the foundation stack

The foundation stack creates long-lived infrastructure (VPC, security group, and a Secrets Manager secret for the GitHub App private key). Deploy it first:

```bash
npx cdk deploy SpotRunnerFoundationStack
```

Note the **PrivateKeySecretArn** from the stack outputs. You'll need it in the next step.

### 3. Create a GitHub App

On your GitHub Enterprise Server:

1. Go to **Settings > Developer settings > GitHub Apps > New GitHub App**
2. Configure the app:
   - **Name**: `Spot Runner` (or your choice)
   - **Homepage URL**: Your organization URL
   - **Webhook URL**: Leave blank for now (you'll update after deploying the app stack)
   - **Webhook secret**: Leave blank for now (the app stack generates one automatically)
3. Set permissions:
   - **Repository permissions**:
     - Actions: Read-only
     - Administration: Read & write (for runner registration)
     - Metadata: Read-only
   - **Organization permissions**:
     - Self-hosted runners: Read & write
4. Subscribe to events:
   - Workflow job
5. Create the app and note the **App ID**
6. Generate and download a **private key**
7. Install the app on repositories/organizations that will use spot runners

### 4. Upload the private key to Secrets Manager

Upload the private key you downloaded to the Secrets Manager secret created by the foundation stack:

```bash
aws secretsmanager put-secret-value \
  --secret-id <PrivateKeySecretArn from step 2> \
  --secret-string "$(cat path/to/private-key.pem)"
```

### 5. Configure and deploy the app stack

The app stack contains all application resources (API Gateway, Lambdas, DynamoDB, Image Builder). It requires the GitHub App ID and server URL, passed via CDK context or environment variables.

Edit `bin/app.ts` to configure your runner presets if you want.

Deploy the app stack:

```bash
npx cdk deploy SpotRunnerStack \
  -c githubServerUrl=https://github.your-company.com \
  -c githubAppId=123456
```

The deployment will:
- Create Image Builder pipelines for each preset
- Automatically trigger the first AMI build
- Initialize the system in "building" state

Note the **WebhookUrl** and **WebhookSecretValue** from the stack outputs.

### 6. Configure the GitHub App webhook

Update your GitHub App with the outputs from the app stack:

1. Go to your GitHub App settings
2. Set **Webhook URL** to the `WebhookUrl` output (e.g., `https://xxx.execute-api.us-east-1.amazonaws.com/prod/webhook`)
3. Set **Webhook secret** to the `WebhookSecretValue` output
4. Ensure **Webhook active** is checked

### 7. Check status

Check the system status to see when AMIs are ready:

```bash
# Get status endpoint URL from stack outputs
curl https://xxx.execute-api.us-east-1.amazonaws.com/prod/status
```

**Response example:**
```json
{
  "status": "building",
  "configuration": { "privateKeyConfigured": true },
  "github": { "status": "connected", "message": "GitHub API authentication successful", "appSlug": "spot-runner" },
  "presets": [
    { "name": "linux-x64", "status": "building", "amiId": null, "updatedAt": "..." }
  ],
  "message": "1 preset building"
}
```

Wait until all presets show `"status": "ready"` before using runners. This typically takes 20-30 minutes for the first build.

### 8. Use in workflows

Update your workflow files to use spot runners:

```yaml
jobs:
  build:
    runs-on: [self-hosted, spotrunner/linux-x64]
    steps:
      - uses: actions/checkout@v4
      - run: npm test
```

## Runner Configuration

### Presets

Runner presets are defined in CDK and manage both the Image Builder pipeline and runner configuration together. This ensures the AMI and config are always in sync.

```typescript
presets: [
  {
    name: "linux-x64",           // Unique identifier
    architecture: "x86_64",      // "x86_64" or "arm64"
    instanceTypes: ["m5.large"], // Optional, defaults by architecture
    labels: ["linux", "ubuntu"], // Additional workflow labels
    additionalDockerImages: ["your-registry/image:tag"], // Pre-pull
    timeout: 120,                // Job timeout in minutes
    diskSizeGb: 100,            // Root volume size
    spotStrategy: "spotPreferred", // Spot instance strategy
  },
]
```

**Preset Fields:**

| Field | Description | Default |
|-------|-------------|---------|
| `name` | Unique preset identifier | Required |
| `architecture` | CPU architecture (`x86_64` or `arm64`) | Required |
| `instanceTypes` | EC2 instance types | `["m5.large", "m5.xlarge"]` for x64, `["m6g.large", "m6g.xlarge"]` for arm64 |
| `labels` | Additional labels for workflow matching | `[]` |
| `additionalDockerImages` | Extra Docker images to pre-pull in AMI | `[]` |
| `timeout` | Job timeout in minutes | `60` |
| `diskSizeGb` | Root volume size in GB | `100` |
| `spotStrategy` | Spot strategy: `spotOnly`, `spotPreferred`, `onDemandOnly` | `spotPreferred` |

### Label Syntax

Spot Runner uses a label-based routing system:

```
spotrunner/<preset>[/<options>]
```

**Examples:**
- `spotrunner/linux-x64` - Use the `linux-x64` preset
- `spotrunner/linux-x64/cpu=4,ram=16` - Request minimum 4 vCPU and 16GB RAM
- `spotrunner/linux-arm64` - Use the ARM64 preset

### Spot Strategies

- `spotOnly` - Only use spot instances (cheapest, may delay jobs if no capacity)
- `spotPreferred` - Try spot first, fall back to on-demand (default, recommended)
- `onDemandOnly` - Always use on-demand (most reliable, most expensive)

## Status API

The `/status` endpoint provides system health and preset readiness information.

**Request:**
```bash
curl https://<api-url>/status
```

**Response:**
```json
{
  "status": "building",
  "configuration": { "privateKeyConfigured": true },
  "github": { "status": "connected", "message": "GitHub API authentication successful", "appSlug": "spot-runner" },
  "presets": [
    {
      "name": "linux-x64",
      "status": "ready",
      "amiId": "ami-12345678",
      "updatedAt": "2026-01-27T12:00:00Z"
    },
    {
      "name": "linux-arm64",
      "status": "building",
      "amiId": null,
      "updatedAt": "2026-01-27T11:30:00Z"
    }
  ],
  "runners": {
    "pending": 1,
    "provisioning": 0,
    "running": 2
  },
  "recentActivity": {
    "lastHour": { "completed": 5, "failed": 0 },
    "last24Hours": { "completed": 42, "failed": 1 }
  },
  "message": "1 preset ready, 1 preset building, 1 pending / 2 running"
}
```

**Status Values:**

| Status | Description |
|--------|-------------|
| `ready` | All presets have valid AMIs and are ready to use |
| `building` | At least one preset is building, none have failed |
| `degraded` | At least one preset has failed or has no AMI |

**Preset Status Values:**

| Status | Description |
|--------|-------------|
| `ready` | AMI is available and preset can be used |
| `building` | Image Builder is creating the AMI |
| `failed` | Image Builder failed (previous AMI may still work) |

## Custom AMI Creation

Spot Runner requires an AMI with the GitHub Actions runner pre-installed. You have two options:

### Option 1: EC2 Image Builder (Recommended)

The app stack includes an EC2 Image Builder pipeline per preset that creates ready-to-use AMIs. The pipeline builds:

- Ubuntu 22.04 LTS base
- Docker and common build tools
- GitHub Actions runner v2.331.0 (SHA256 verified)
- Pre-pulled Docker images: node:20, python:3.11, golang:1.21, alpine:3.19, ubuntu:22.04

AMIs are managed automatically. When Image Builder completes a build, the AMI Update Lambda updates the preset's SSM config and DynamoDB state. No manual AMI ID management is required.

To pre-pull additional Docker images, add them to the preset's `additionalDockerImages` field in `bin/app.ts`.

### Option 2: Bring Your Own AMI

You can use any AMI that meets these requirements:

| Requirement | Details |
|-------------|---------|
| Runner location | `/opt/actions-runner/` with `run.sh` executable |
| Runner version | 2.311.0+ recommended |
| AWS CLI | Installed and in PATH (for self-termination) |
| IMDSv2 | Instance must support IMDSv2 |
| User | Runner files owned by `ubuntu` user |

**Building from scratch:**

```bash
# On an Ubuntu 22.04 instance:
sudo mkdir -p /opt/actions-runner && cd /opt/actions-runner
curl -sL https://github.com/actions/runner/releases/download/v2.331.0/actions-runner-linux-x64-2.331.0.tar.gz | sudo tar xz
sudo chown -R ubuntu:ubuntu /opt/actions-runner
# Create AMI from this instance
```

## Architecture

### Stacks

The infrastructure is split into two CDK stacks for faster iteration:

| Stack | Resources | Change Frequency |
|-------|-----------|-----------------|
| **SpotRunnerFoundationStack** | VPC, NAT gateway, security group, private key secret | Rarely changes |
| **SpotRunnerStack** | API Gateway, Lambdas, DynamoDB, Image Builder, SSM configs, webhook secret | Frequently iterated |

This separation means you can tear down and redeploy the app stack without waiting for VPC/NAT gateway recreation.

### Components

| Component | Stack | Description |
|-----------|-------|-------------|
| **VPC** | Foundation | VPC with public and private subnets |
| **Runner Security Group** | Foundation | Security group for runner instances |
| **Private Key Secret** | Foundation | Secrets Manager secret for GitHub App private key |
| **API Gateway** | App | HTTPS endpoint for webhooks and status API |
| **Webhook Secret** | App | Auto-generated webhook secret for GitHub signature validation |
| **Webhook Lambda** | App | Receives GitHub webhooks, validates signatures, provisions runners |
| **Cleanup Lambda** | App | Scheduled function that terminates stuck/orphaned instances |
| **AMI Update Lambda** | App | Processes Image Builder events, updates AMI state and SSM configs |
| **Status Lambda** | App | Provides `/status` API endpoint for system health |
| **DynamoDB Table** | App | Tracks runner state and AMI lifecycle |
| **EventBridge** | App | Routes Image Builder completion events |
| **Image Builder** | App | Creates runner AMIs per preset |
| **Launch Template** | App | EC2 configuration for runner instances |
| **SSM Parameters** | App | Stores runner configurations (auto-managed) |

### Job Provisioning Flow

1. GitHub sends `workflow_job.queued` webhook
2. Webhook Lambda validates signature and `spotrunner/*` label
3. Lambda looks up preset configuration in SSM
4. Lambda checks if AMI is ready (rejects if still building)
5. Lambda requests JIT runner token from GitHub
6. Lambda provisions EC2 spot instance via Fleet API
7. Instance boots, registers with GitHub, runs job
8. Instance self-terminates after job completion

### AMI Lifecycle Flow

1. On deploy, Image Builder pipelines are triggered for each preset
2. DynamoDB records preset state as "building"
3. When Image Builder completes, EventBridge triggers AMI Update Lambda
4. Lambda updates DynamoDB state to "ready" with AMI ID
5. Lambda updates SSM config with new AMI ID
6. Subsequent jobs use the new AMI automatically
7. Weekly scheduled rebuilds keep AMIs fresh

### Security

- **Webhook validation**: HMAC-SHA256 signature verification
- **JIT tokens**: Single-use, short-lived runner registration
- **IAM least privilege**: Lambda and instance roles have minimal permissions
- **VPC isolation**: Runners launch in your VPC
- **IMDSv2 required**: Instance metadata secured
- **SHA256 verification**: Runner binary verified against hardcoded checksums
- **Secrets Manager**: Private key and webhook secret stored securely (never passed as env vars)

## Troubleshooting

### Runner not starting

1. Check CloudWatch Logs for the webhook Lambda
2. Verify the GitHub App is installed on the repository
3. Check the `spotrunner/*` label is present in the workflow
4. Verify the private key has been uploaded to Secrets Manager (check `/status` endpoint for warnings)

### Spot capacity unavailable

The runner will automatically fall back to on-demand if `spotStrategy` is `spotPreferred`. For `spotOnly`, the job will wait until capacity is available.

### Job timeout

Default timeout is 1 hour. Configure `timeout` in the preset definition in `bin/app.ts` and redeploy:

```typescript
presets: [
  {
    name: "linux-x64",
    architecture: "x86_64",
    timeout: 240,  // 4 hours
    // ...
  },
]
```

### Orphaned instances

The cleanup Lambda runs every 5 minutes and terminates:
- Instances stuck in "provisioning" for >10 minutes
- Instances running longer than their configured timeout
- Instances without valid state records

## Development

```bash
# Run tests
npm test

# Run linter
npm run lint

# Synthesize CloudFormation
npx cdk synth

# Deploy foundation stack (first time / infrastructure changes)
npx cdk deploy SpotRunnerFoundationStack

# Deploy app stack
npx cdk deploy SpotRunnerStack \
  -c githubServerUrl=https://github.your-company.com \
  -c githubAppId=123456

# Destroy (app stack first, then foundation)
npx cdk destroy SpotRunnerStack
npx cdk destroy SpotRunnerFoundationStack
```

## License

MIT
