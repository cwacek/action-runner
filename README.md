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

### 2. Create a GitHub App

On your GitHub Enterprise Server:

1. Go to **Settings → Developer settings → GitHub Apps → New GitHub App**
2. Configure the app:
   - **Name**: `Spot Runner` (or your choice)
   - **Homepage URL**: Your organization URL
   - **Webhook URL**: Leave blank for now (you'll update after deployment)
   - **Webhook secret**: Generate a secure random string and save it
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

### 3. Configure presets

Create or update `bin/app.ts` to configure your runner presets:

```typescript
new SpotRunnerStack(app, "SpotRunnerStack", {
  githubServerUrl: "https://github.your-company.com",
  githubAppId: "123456",
  githubAppPrivateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
  webhookSecret: process.env.WEBHOOK_SECRET!,
  presets: [
    {
      name: "linux-x64",
      architecture: "x86_64",
      instanceTypes: ["m5.large", "m5.xlarge", "m5a.large"],
      labels: ["linux", "ubuntu"],
    },
    {
      name: "linux-arm64",
      architecture: "arm64",
      instanceTypes: ["m6g.large", "m6g.xlarge"],
      labels: ["linux", "ubuntu", "arm"],
    },
  ],
});
```

### 4. Deploy the stack

```bash
# Set required secrets
export GITHUB_APP_PRIVATE_KEY="$(cat path/to/private-key.pem)"
export WEBHOOK_SECRET="your-webhook-secret"

# Deploy
npx cdk deploy
```

The deployment will:
- Create Image Builder pipelines for each preset
- Automatically trigger the first AMI build
- Initialize the system in "building" state

### 5. Check status

After deployment, check the system status to see when AMIs are ready:

```bash
# Get status endpoint URL from stack outputs
curl https://xxx.execute-api.us-east-1.amazonaws.com/prod/status
```

**Response example:**
```json
{
  "status": "building",
  "presets": [
    { "name": "linux-x64", "status": "building", "amiId": null, "updatedAt": "..." }
  ],
  "message": "1 preset building"
}
```

Wait until all presets show `"status": "ready"` before using runners. This typically takes 20-30 minutes for the first build.

### 7. Configure the webhook URL

After deployment, the stack outputs the webhook URL. Update your GitHub App:

1. Go to your GitHub App settings
2. Set **Webhook URL** to the output URL (e.g., `https://xxx.execute-api.us-east-1.amazonaws.com/prod/webhook`)
3. Ensure **Webhook active** is checked

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
  "status": "ready",
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
  "message": "1 preset ready, 1 preset building"
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

The stack includes an EC2 Image Builder pipeline that creates ready-to-use AMIs. The pipeline builds:

- Ubuntu 22.04 LTS base
- Docker and common build tools
- GitHub Actions runner v2.331.0 (SHA256 verified)
- Pre-pulled Docker images: node:20, python:3.11, golang:1.21, alpine:3.19, ubuntu:22.04

To customize the pipeline (e.g., add more Docker images):

```typescript
new RunnerImagePipeline(this, "ImagePipeline", {
  vpc: this.vpc,
  subnet: this.vpc.privateSubnets[0],
  additionalDockerImages: ["your-registry/custom-image:tag"],
  buildSchedule: "cron(0 0 ? * SUN *)", // Weekly rebuilds
});
```

After running the pipeline, update your SSM configuration with the new AMI ID.

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

### Components

| Component | Description |
|-----------|-------------|
| **Webhook Lambda** | Receives GitHub webhooks, validates signatures, provisions runners |
| **Cleanup Lambda** | Scheduled function that terminates stuck/orphaned instances |
| **AMI Update Lambda** | Processes Image Builder events, updates AMI state and SSM configs |
| **Status Lambda** | Provides `/status` API endpoint for system health |
| **DynamoDB Table** | Tracks runner state and AMI lifecycle |
| **API Gateway** | HTTPS endpoint for webhooks and status API |
| **EventBridge** | Routes Image Builder completion events |
| **Image Builder** | Creates runner AMIs per preset |
| **Launch Template** | EC2 configuration for runner instances |
| **Secrets Manager** | Stores GitHub App private key and webhook secret |
| **SSM Parameters** | Stores runner configurations (auto-managed) |

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

## Troubleshooting

### Runner not starting

1. Check CloudWatch Logs for the webhook Lambda
2. Verify the GitHub App is installed on the repository
3. Check the `spotrunner/*` label is present in the workflow

### Spot capacity unavailable

The runner will automatically fall back to on-demand if `spotStrategy` is `spotPreferred`. For `spotOnly`, the job will wait until capacity is available.

### Job timeout

Default timeout is 1 hour. Increase `timeout` in SSM configuration for longer jobs:

```bash
aws ssm put-parameter --name "/spot-runner/configs/linux-x64" \
  --type String --overwrite \
  --value '{"timeout": 14400, ...}'  # 4 hours
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

# Deploy to dev environment
npx cdk deploy --context env=dev
```

## License

MIT
