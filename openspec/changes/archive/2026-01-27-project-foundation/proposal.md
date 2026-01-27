## Why

Self-hosted GitHub Actions runners are expensive to run 24/7, but cloud-hosted runners lack customization and can be slow. This project provides on-demand GitHub Actions runners using AWS spot instances that spin up only when needed and terminate when idle—achieving near-zero cost when not in use while providing full control over runner configuration.

## What Changes

- Ephemeral runner infrastructure that scales to zero when idle
- GitHub Enterprise Server App integration for secure, native authentication
- AWS spot instance provisioning for cost-efficient compute
- Simple deployment via CDK or CloudFormation (infrastructure as code)
- Transparent usage: workflows just specify a custom `runs-on` label

## Capabilities

### New Capabilities

- `runner-lifecycle`: Manages the full lifecycle of ephemeral runners—provisioning spot instances when jobs are queued, registering them with GitHub, and terminating them after job completion or timeout.

- `github-app-integration`: GitHub Enterprise Server App that authenticates natively, receives webhook events for workflow jobs, and manages runner registration tokens.

- `spot-provisioning`: AWS spot instance management including instance type selection, spot pricing strategies, availability zone failover, and graceful interruption handling.

- `infrastructure-deployment`: CDK and/or CloudFormation constructs for deploying the complete solution with sensible defaults and customization options.

- `workflow-routing`: Label-based routing system that maps `runs-on` values to runner configurations (instance types, AMIs, storage, etc.).

### Modified Capabilities

<!-- None - this is a new project -->

## Impact

**AWS Resources**:
- Lambda or lightweight always-on component for webhook handling
- EC2 spot instances (on-demand, ephemeral)
- IAM roles and policies
- VPC/networking 
- S3 or SSM for configuration/secrets

**GitHub Enterprise Server**:
- GitHub App registration
- Webhook configuration
- Runner group management

**User Workflow Files**:
- Custom `runs-on` labels (e.g., `runs-on: [self-hosted, spot-runner, linux, x64]`)
