## Context

The current architecture has a circular dependency problem (catch-22):

1. To register a GitHub App, you need a valid webhook URL
2. The webhook URL is created by `SpotRunnerStack`
3. `SpotRunnerStack` requires `githubAppId`, `githubAppPrivateKey`, and `webhookSecret` as inputs
4. These values only exist after the GitHub App is registered

This means deploying a new environment requires manual workarounds or dummy deployments.

**Current architecture:**
- `SpotRunnerFoundationStack`: VPC, security groups
- `SpotRunnerStack`: Everything else (API Gateway, Lambda handlers, DynamoDB, Secrets Manager, etc.)

## Goals / Non-Goals

**Goals:**
- Enable deploying the webhook endpoint BEFORE registering the GitHub App
- Allow `githubAppId` and `webhookSecret` to be provided at app-stack deploy time (after App registration)
- Generate the `githubAppPrivateKey` in the foundation stack so GitHub can sign against it
- Maintain CDK cross-stack references between foundation and app stacks

**Non-Goals:**
- Automating GitHub App registration itself
- Supporting multiple GitHub Apps per deployment
- Backwards compatibility with existing deployments (none exist per proposal)

## Decisions

### 1. Move API Gateway to FoundationStack

**Decision**: Create the API Gateway and its base URL in `SpotRunnerFoundationStack`.

**Rationale**: The API Gateway URL is needed before any GitHub App configuration exists. By creating it in the foundation stack, the URL is available immediately after the first deployment.

**Alternatives considered**:
- Create a separate "bootstrap" stack just for the URL → Adds complexity, another stack to manage
- Use a pre-allocated custom domain → Requires Route 53 setup, external dependency

### 2. Generate Private Key in FoundationStack

**Decision**: Generate an RSA private key in the foundation stack and store it in Secrets Manager. Export the public key so it can be uploaded to GitHub during App registration.

**Rationale**: GitHub App uses the private key to verify webhook signatures and API authentication. By generating it before the App exists, we can:
1. Upload the public key during App registration
2. Reference the existing secret from the app stack

**Implementation**: Use a custom resource (Lambda) to generate a 2048-bit RSA key pair on first deploy. Store private key in Secrets Manager, output public key as a CloudFormation output.

**Alternatives considered**:
- User generates key externally and provides it → More manual steps, same catch-22 for key storage
- Generate in app stack → Doesn't solve the ordering problem

### 3. Move Webhook Secret Generation to FoundationStack

**Decision**: Generate the webhook secret in the foundation stack and store it in Secrets Manager.

**Rationale**: The webhook secret needs to exist before GitHub App registration (to configure the App), and the Lambda handler needs to read it to verify webhook signatures.

**Implementation**: Use `secretsmanager.Secret.generateSecretString()` to create a random secret on first deploy.

### 4. Pass GitHub App ID and Server URL to AppStack

**Decision**: Keep `githubAppId` and `githubServerUrl` as required parameters for `SpotRunnerStack`.

**Rationale**: These values:
- Come from GitHub after App registration
- Are not secrets (safe in CDK context)
- Cannot be auto-generated

The workflow becomes:
1. Deploy FoundationStack → Get webhook URL, public key, webhook secret
2. Register GitHub App using those values → Get App ID
3. Deploy SpotRunnerStack with App ID

### 5. Lambda Handler Architecture

**Decision**: Keep webhook handler Lambda in `SpotRunnerStack`, but have it import the API Gateway from the foundation stack.

**Rationale**: The Lambda code depends on DynamoDB tables, SSM parameters, and other app-stack resources. Moving it to foundation would create more cross-stack dependencies.

**Implementation**:
- FoundationStack exports API Gateway REST API
- AppStack imports it and adds the POST /webhook route with the Lambda integration

## Risks / Trade-offs

**[Risk] Key rotation complexity** → The generated private key is tied to the foundation stack. Rotating it requires GitHub App reconfiguration. Mitigation: Document the rotation process; this is an infrequent operation.

**[Risk] Foundation stack deletion destroys keys** → Deleting the foundation stack removes the private key and webhook secret. Mitigation: Enable deletion protection on the foundation stack; add Secrets Manager retention policies.

**[Risk] Cross-stack coupling** → More resources exported from foundation means tighter coupling. Mitigation: Keep exports minimal (API Gateway, secrets ARNs, VPC); document dependencies clearly.

**[Trade-off] Two-phase deployment** → Initial setup requires deploying foundation, registering App, then deploying app stack. Accepted: This is a one-time setup cost that solves the catch-22.

## Migration Plan

Not applicable - no existing deployments per proposal.

## Open Questions

None - the approach is straightforward given the single-deployment constraint.
