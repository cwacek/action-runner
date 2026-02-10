## Why

The `/status` endpoint currently checks whether the GitHub App private key is non-placeholder, but never verifies that the system can actually **authenticate and communicate** with GitHub. A misconfigured App ID, invalid private key, unreachable server, or network issue will all show `privateKeyConfigured: true` while the system silently fails to process webhooks. Operators have no way to detect these problems until a workflow job hangs waiting for a runner.

## What Changes

- The status handler will **generate a JWT and call the GitHub App API** (`GET /api/v3/app`) to verify the full authentication chain works: private key is valid, App ID is correct, and the GitHub server is reachable.
- The status response will include a new `github` section reporting connectivity status, with specific error categorization (auth failure, unreachable, etc.).
- The overall system status aggregation will factor in GitHub connectivity — a system that can't talk to GitHub is degraded regardless of AMI readiness.
- The CDK construct for the status handler will be updated to pass the GitHub App ID and server URL as environment variables.

## Capabilities

### New Capabilities
- `github-connectivity-check`: Active verification of GitHub App authentication by generating a JWT and calling the GitHub API. Reports reachable/auth status with error categorization. Integrated into the status endpoint response and overall system health.

### Modified Capabilities
- `status-api`: Response schema extended with a `github` section containing connectivity status. Overall status aggregation updated to factor in GitHub connectivity (unreachable or auth-failed → degraded).

## Impact

- **Lambda:** `status-handler.ts` — add GitHub API call, extend response schema
- **CDK construct:** `lib/constructs/status-handler.ts` — add `githubAppId` and `githubServerUrl` props, pass as env vars
- **CDK stack:** `lib/spot-runner-stack.ts` — pass new props to StatusHandler construct
- **Shared lib:** Reuse `generateAppJwt` from `lambda/lib/github-app.ts`
- **Latency:** Status endpoint will take slightly longer (~200-500ms) due to the outbound GitHub API call. Consider caching the result for the Lambda invocation lifetime (same pattern as private key check).
- **No breaking changes** to existing response fields — `github` section is purely additive.
