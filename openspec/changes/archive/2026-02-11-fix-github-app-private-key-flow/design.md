## Context

The current implementation has two problems:
1. Uses a `KeyGenerator` construct that generates an RSA key pair - but GitHub generates the private key, not us
2. Foundation stack creates API Gateway to output webhook URL before GitHub App creation - but GitHub allows updating webhook URL after app creation

**Corrected GitHub App flow:**
1. User deploys foundation stack → gets private key secret ARN
2. User creates GitHub App on GitHub (without webhook URL)
3. GitHub generates private key → user downloads it
4. User uploads private key to the foundation stack's secret
5. User deploys app stack → gets webhook URL and webhook secret
6. User updates GitHub App settings with webhook URL and secret

This eliminates the chicken-and-egg problem entirely by moving API Gateway to the app stack.

## Goals / Non-Goals

**Goals:**
- Remove RSA key generation from foundation stack
- Move API Gateway and webhook secret generation from foundation stack to app stack
- Foundation stack becomes minimal: VPC, security group, empty private key secret
- App stack outputs webhook URL and webhook secret for GitHub App configuration
- Status page warns when private key is not configured

**Non-Goals:**
- Automating GitHub App creation
- Building a UI for uploading the private key
- Validating private key format

## Decisions

### Decision 1: Remove KeyGenerator construct entirely

**Choice:** Delete the `KeyGenerator` construct and its custom resource Lambda.

**Rationale:** The construct generates RSA keys, which is incorrect. GitHub generates the private key.

**Alternatives considered:**
- Repurpose to create empty secret → Unnecessary indirection

### Decision 2: Move API Gateway to app stack

**Choice:** App stack creates the API Gateway REST API instead of foundation stack.

**Rationale:**
- Eliminates the need for webhook URL before GitHub App creation
- API Gateway is tied to Lambda integration anyway (app stack concern)
- Foundation stack remains truly "foundational" - just networking and secrets

**Alternatives considered:**
- Keep API Gateway in foundation, still require webhook URL upfront → Doesn't solve the core problem
- Create API Gateway in foundation without routes, add routes in app → More complexity, cross-stack API Gateway manipulation is tricky

### Decision 3: Move webhook secret to app stack

**Choice:** App stack generates the webhook secret and outputs it.

**Rationale:** The webhook secret is only needed after the app is deployed and you're configuring the GitHub App. It makes sense to generate and output it together with the webhook URL.

**Alternatives considered:**
- Keep in foundation → No benefit, adds cross-stack dependency for no reason

### Decision 4: Create empty secret with descriptive placeholder

**Choice:** Foundation stack creates a Secrets Manager secret with a placeholder value.

```typescript
const privateKeySecret = new secretsmanager.Secret(this, "PrivateKeySecret", {
  description: "GitHub App private key - upload after creating the app on GitHub",
  secretStringValue: cdk.SecretValue.unsafePlainText("PLACEHOLDER: Upload your GitHub App private key here"),
});
```

**Rationale:** A placeholder string allows the status page to detect incomplete setup by checking if the value starts with "PLACEHOLDER:".

**Alternatives considered:**
- Leave truly empty → Harder to distinguish from read failures
- Separate SSM parameter flag → More complexity

### Decision 5: Status handler checks private key configuration

**Choice:** Status handler reads the private key secret and checks for placeholder value.

**Implementation:**
- Add `configuration.privateKeyConfigured: boolean` to response
- Overall status becomes `degraded` if not configured
- Message includes "GitHub App private key not configured"

**Rationale:** Status page already aggregates health; configuration completeness is a natural extension.

### Decision 6: Webhook handler fails fast on missing private key

**Choice:** Webhook handler checks private key at startup and returns 503 if unconfigured.

**Rationale:** Clear error message helps users diagnose setup issues quickly rather than cryptic GitHub API errors.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| User forgets to upload private key | Status page warning; webhook returns 503 with clear message |
| User forgets to update GitHub App with webhook URL | First webhook will fail; status page could add GitHub API check later |
| Breaking change for existing deployments | No existing deployments per proposal |
| API Gateway in app stack means longer deploy cycles | Acceptable trade-off for simpler setup flow |

## Open Questions

1. ~~Should we validate private key format?~~ No, GitHub API will reject invalid keys with clear errors.
2. ~~Should webhook handler check and fail fast?~~ Yes, included in design.
