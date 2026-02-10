## 1. CDK Infrastructure — Thread GitHub config to status handler

- [x]1.1 Add `githubAppId: string` and `githubServerUrl: string` to `StatusHandlerProps` in `lib/constructs/status-handler.ts`
- [x]1.2 Pass `GITHUB_APP_ID` and `GITHUB_SERVER_URL` as environment variables on the status Lambda function in `lib/constructs/status-handler.ts`
- [x]1.3 Update the `StatusHandler` instantiation in `lib/spot-runner-stack.ts` to pass `githubAppId: props.githubAppId` and `githubServerUrl: props.githubServerUrl`

## 2. GitHub Connectivity Check — Core logic

- [x]2.1 Add `checkGitHubConnectivity` function in `lambda/status-handler.ts` that generates a JWT via `generateAppJwt` from `lambda/lib/github-app.ts` and calls `GET {serverUrl}/api/v3/app`
- [x]2.2 Implement error categorization: return `"connected"` on HTTP 200, `"auth_error"` on 401/403, `"unreachable"` on network errors (DNS, timeout, connection refused, TLS), `"error"` on other HTTP statuses
- [x]2.3 Extract `appSlug` from the `/app` response body (`slug` field) on successful connection
- [x]2.4 Skip the connectivity check and return `status: "error"` with descriptive message when `privateKeyConfigured` is false
- [x]2.5 Add module-level cache variable (`cachedGitHubStatus`) following the same pattern as `cachedPrivateKeyConfigured`

## 3. Status Response — Extend schema and aggregation

- [x]3.1 Add `GitHubStatus` type and `github` field to the `StatusResponse` interface in `lambda/status-handler.ts`
- [x]3.2 Update `aggregateStatus` to accept GitHub connectivity status and return `"degraded"` when it is not `"connected"`
- [x]3.3 Update `generateMessage` to include GitHub connectivity issues in the human-readable message
- [x]3.4 Wire the connectivity check into the handler: call `checkGitHubConnectivity` in parallel with existing checks, include result in response

## 4. Verification

- [x]4.1 Run `npx tsc --noEmit` to verify no type errors
- [x]4.2 Run `npx cdk synth` to verify CDK stack synthesizes correctly with the new props
