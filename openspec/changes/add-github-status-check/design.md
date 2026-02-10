## Context

The `/status` endpoint (`lambda/status-handler.ts`) reports system health by checking AMI states in DynamoDB and whether the private key secret is non-placeholder. It runs outside a VPC with a 10-second timeout. The webhook handler already authenticates with GitHub using `generateAppJwt` from `lambda/lib/github-app.ts`, but the status handler has no GitHub API interaction — it only has `STATE_TABLE_NAME` and `PRIVATE_KEY_SECRET_ARN` environment variables today.

The stack already passes `githubAppId` and `githubServerUrl` to the webhook handler; the same values need to be threaded through to the status handler construct.

## Goals / Non-Goals

**Goals:**
- Verify the full GitHub authentication chain: private key is valid, App ID is correct, server is reachable
- Report specific failure categories (auth error, unreachable, misconfigured) so operators can diagnose issues
- Factor GitHub connectivity into the overall system status (can't connect → degraded)
- Cache the connectivity check per Lambda invocation to avoid redundant API calls

**Non-Goals:**
- Testing installation-level access (requires knowing an installation ID — the `/app` endpoint only needs app-level JWT auth)
- Building a separate health-check scheduler or alarm system
- Adding retry logic for transient failures — the next status poll will re-check

## Decisions

### 1. Use `GET /api/v3/app` as the connectivity check endpoint

**Decision:** Call `GET {serverUrl}/api/v3/app` with a JWT Bearer token.

**Rationale:** This endpoint authenticates with the App JWT (not an installation token), returns the App's metadata, and requires no additional parameters. It validates all three things we care about: server reachable, App ID valid, private key valid. Alternative considered: `GET /api/v3/app/installations` — works but returns potentially sensitive installation data we'd need to discard. The `/app` endpoint is simpler and sufficient.

### 2. Reuse `generateAppJwt` from `lambda/lib/github-app.ts`

**Decision:** Import and call the existing `generateAppJwt(appId, privateKey)` function.

**Rationale:** This function already handles JWT creation with RS256 signing, clock drift compensation, and base64url encoding. No reason to duplicate it. The status handler already reads the private key from Secrets Manager, so we have both required inputs.

### 3. Categorize errors into specific statuses

**Decision:** The `github` section will report one of:
- `"connected"` — JWT auth succeeded, server responded with 200
- `"auth_error"` — Server reachable but returned 401/403 (bad key or App ID)
- `"unreachable"` — Network error, timeout, or non-HTTP failure (DNS, TLS, connection refused)
- `"error"` — Unexpected failure (5xx from GitHub, malformed response, etc.)

**Rationale:** Operators need to distinguish between "your private key is wrong" and "your network can't reach GitHub" — these have completely different remediation paths. Alternative considered: a simple boolean `connected: true/false`. Rejected because it loses diagnostic information that's cheap to provide.

### 4. Cache connectivity result per Lambda invocation

**Decision:** Use a module-level variable (same pattern as `cachedPrivateKeyConfigured`) to cache the GitHub connectivity check result for the lifetime of the Lambda container.

**Rationale:** Lambda containers are reused across invocations. Caching means the first invocation on a warm container does the check, and subsequent invocations reuse the result. This is acceptable because: (a) cold starts always get a fresh check, (b) Lambda containers are recycled periodically, (c) a stale "connected" result for a few minutes is low risk since the status endpoint is advisory. The private key check already follows this exact pattern.

### 5. Add `github` section to the response — additive, no breaking changes

**Decision:** Extend the `StatusResponse` interface with:
```typescript
github: {
  status: "connected" | "auth_error" | "unreachable" | "error";
  message: string;         // Human-readable explanation
  appSlug?: string;        // App slug from /app response (when connected)
}
```

**Rationale:** Additive change preserves backward compatibility. Including the `appSlug` when connected gives operators a quick confirmation of which App is configured. The `message` field provides actionable diagnostics (e.g., "GitHub API returned 401: Bad credentials").

### 6. Factor connectivity into overall status aggregation

**Decision:** If `github.status` is anything other than `"connected"`, the overall system status becomes `"degraded"` regardless of AMI readiness. The human-readable message will include the GitHub connectivity issue.

**Rationale:** A system with healthy AMIs but no GitHub connectivity cannot process webhooks or generate JIT tokens — it's non-functional. This matches the existing pattern where `privateKeyConfigured: false` also forces "degraded".

### 7. Thread `githubAppId` and `githubServerUrl` through CDK construct

**Decision:** Add `githubAppId: string` and `githubServerUrl: string` to `StatusHandlerProps`. Pass them as `GITHUB_APP_ID` and `GITHUB_SERVER_URL` environment variables on the Lambda. Update `spot-runner-stack.ts` to pass these from its existing props.

**Rationale:** Follows the same pattern as the webhook handler. These values come from CDK context at deploy time and are not sensitive.

## Risks / Trade-offs

**[Latency increase]** The GitHub API call adds ~200-500ms to the status endpoint response time. → Mitigated by caching per Lambda invocation. First call on a cold container is slower; subsequent calls are instant.

**[GHE rate limiting]** Frequent status polling could contribute to GitHub API rate limits. → The `/app` endpoint is lightweight and rate limits for App JWTs are generous (5000/hr). With invocation-level caching, actual API calls are infrequent.

**[Stale cache]** A cached "connected" result could mask a newly-broken connection. → Acceptable tradeoff. Lambda containers are recycled periodically, and the status endpoint is advisory — operators typically poll it repeatedly. A stale result lasts at most the container lifetime (minutes to hours in practice).

**[Private key not yet configured]** If the private key is still a placeholder, we should skip the connectivity check entirely rather than reporting a confusing auth error. → Check `privateKeyConfigured` first; if false, set `github.status` to `"error"` with message "Private key not configured — skipping connectivity check".
