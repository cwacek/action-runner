## Context

The status handler (`lambda/status-handler.ts`) queries DynamoDB for AMI states and reports them directly. The AMI update handler (`lambda/ami-update-handler.ts`) processes EventBridge events to transition states. If an event is lost, the state is stuck forever.

Key existing patterns:
- `queryAllAmiStates()` returns all AMI records from DynamoDB (uses `recordType-index` GSI)
- `upsertAmiState()` does conditional writes (timestamp-based, prevents race conditions)
- SSM update logic exists in `ami-update-handler.ts` as `updateSsmConfig()`
- Image Builder pipeline names follow the pattern `spot-runner-${presetName}` (line 301, `runner-image-pipeline.ts`)
- DynamoDB AMI records have: `jobId` (PK: `AMI#<preset>`), `status`, `amiId`, `buildId`, `updatedAt`
- The `buildId` field stores the image build version ARN when available, but the initial record created by the preset initializer won't have it (it's set before any build completes)

The status handler currently runs outside a VPC with a 10-second timeout. It already makes external calls (Secrets Manager, DynamoDB, GitHub API).

## Goals / Non-Goals

**Goals:**
- Stale `building` presets self-heal on the next `/status` call
- DynamoDB and SSM are corrected when reconciliation discovers a completed/failed build
- Reconciliation only triggers for genuinely stale records, not active builds
- Minimal latency impact on the common case (no stale builds)

**Non-Goals:**
- Real-time detection of missed events (polling on a schedule is sufficient via status calls)
- Handling the case where Image Builder has never been triggered (that's a deployment issue)
- Reconciling `failed` or `ready` states (only `building` can get stuck)

## Decisions

### 1. Staleness threshold: 30 minutes

**Decision:** Only reconcile AMI records with `status: "building"` and `updatedAt` older than 90 minutes.

**Rationale:** Image Builder builds typically take 20-60 minutes. A 30-minute threshold gives a generous buffer so we don't reconcile a legitimately active build. The preset initializer writes `updatedAt` when it creates the initial "building" record, so this timestamp reflects when the build was kicked off. Alternative considered:

### 2. Pipeline discovery: ListImagePipelines by name

**Decision:** Look up the Image Builder pipeline ARN using `ListImagePipelines` filtered to name `spot-runner-${presetName}`.

**Rationale:** The `buildId` field on the DynamoDB record may be null for the initial "building" record (created before any build completes). We can't rely on it for discovery. The pipeline name is deterministic from the preset name, so `ListImagePipelines` with a name filter is reliable. Alternative considered: storing the pipeline ARN in DynamoDB at initialization time — cleaner but requires a schema migration for existing records.

### 3. Image discovery: ListImagePipelineImages for latest

**Decision:** Call `ListImagePipelineImages` with the discovered pipeline ARN to get the most recent image. Check its state via `GetImage`.

**Rationale:** This gives us the actual latest build output for the pipeline, regardless of whether we received the EventBridge event. We take the first (most recent) result. If no images exist, the pipeline hasn't produced output yet — leave the state as-is.

### 4. Reconciliation writes: reuse existing patterns

**Decision:** Use `upsertAmiState()` for DynamoDB updates and extract the `updateSsmConfig()` logic into a shared utility so both the AMI update handler and status handler can use it.

**Rationale:** `upsertAmiState` already handles conditional writes to prevent race conditions. The SSM update logic is identical in both contexts. Extracting it avoids duplication. The function currently lives in `ami-update-handler.ts` and should move to `lambda/lib/ami-state.ts` or a new `lambda/lib/ssm-config.ts`.

### 5. Cache reconciliation per Lambda invocation

**Decision:** Cache the reconciled AMI states in a module-level variable. If reconciliation has run once on this container, don't re-run it.

**Rationale:** Same pattern as `cachedPrivateKeyConfigured` and `cachedGitHubStatus`. The first invocation on a cold container does the work; subsequent invocations reuse the result. This is acceptable because Lambda containers are recycled periodically, and a new deploy or container rotation will trigger a fresh check.

### 6. Side effects in the status handler

**Decision:** The status handler will write to DynamoDB and SSM when reconciliation discovers a completed build. This is an intentional side effect.

**Rationale:** The spec says status should reflect actual pipeline state. The most reliable way to ensure this is to correct the data at read time. The writes are idempotent (conditional timestamp check) so concurrent status calls won't conflict. The alternative — leaving DynamoDB stale and only reporting the correct status — means the webhook handler would still see the wrong AMI state when processing jobs.

### 7. Status handler timeout increase

**Decision:** Increase status Lambda timeout from 10 seconds to 30 seconds.

**Rationale:** Reconciliation involves up to 3 Image Builder API calls per stale preset plus SSM reads/writes. The current 10-second timeout is tight when combined with DynamoDB, Secrets Manager, and GitHub API calls. 30 seconds provides headroom. This only matters on the first call when reconciliation runs; subsequent cached calls are fast.

## Risks / Trade-offs

**[Status endpoint has write side effects]** The status endpoint is traditionally read-only. Now it can modify DynamoDB and SSM. → The writes are idempotent and only trigger for genuinely stale records. The benefit (self-healing) outweighs the purity concern. The alternative (a separate reconciliation job) adds infrastructure complexity for the same outcome.

**[Image Builder API rate limits]** `ListImagePipelines` and `ListImagePipelineImages` have rate limits. → These are only called for stale presets (>30 min building), cached per container, and there are typically 1-3 presets total. Rate limit risk is negligible.

**[Reconciliation latency]** The first status call after detecting a stale build will be slower. → Only affects the uncommon case (stale build). Cached after first call. 30-second timeout provides headroom.

**[SSM update function extraction]** Moving `updateSsmConfig` to shared code changes `ami-update-handler.ts`. → Straightforward refactor. The function has no handler-specific dependencies.
