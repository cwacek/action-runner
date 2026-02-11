## Why

The system relies on EventBridge events to transition AMI state from `building` to `ready` or `failed` in DynamoDB. If the AMI update handler crashes (as in ar-ax6) or an event is lost for any reason, the DynamoDB record gets stuck at `building` permanently. The status endpoint then reports the preset as "building" indefinitely, even though the Image Builder pipeline has long since completed.

The status-api spec says preset status should reflect whether the pipeline **is actually running** — but the current implementation blindly trusts DynamoDB without verifying against Image Builder's real state.

## What Changes

- The status handler will detect stale `building` states (older than a threshold) and cross-check them against the actual Image Builder pipeline state.
- When reconciliation discovers a completed or failed build, it updates DynamoDB and SSM inline so the status response reflects reality.
- The reconciliation result is cached per Lambda invocation to avoid redundant Image Builder API calls.
- The CDK construct for the status handler gains IAM permissions for Image Builder read APIs and SSM write access.

## Capabilities

### New Capabilities
- `ami-state-reconciliation`: Detects stale `building` AMI states in DynamoDB and reconciles them against actual Image Builder pipeline state. Corrects DynamoDB and SSM when builds have completed or failed without the event being processed.

### Modified Capabilities
- `status-api`: The status handler gains reconciliation behavior — stale `building` presets are verified against Image Builder before being reported. The response reflects actual pipeline state, not just DynamoDB.

## Impact

- **Lambda:** `status-handler.ts` — add reconciliation logic, Image Builder API calls, SSM update calls
- **CDK construct:** `lib/constructs/status-handler.ts` — add IAM permissions for `imagebuilder:ListImagePipelines`, `imagebuilder:ListImagePipelineImages`, `imagebuilder:GetImage`, and `ssm:GetParameter`/`ssm:PutParameter`
- **Shared lib:** Reuse `upsertAmiState` from `lambda/lib/ami-state.ts` and SSM update pattern from `lambda/ami-update-handler.ts`
- **Latency:** First `/status` call after a stale build is detected will be slower (~500ms-1s for Image Builder API calls). Subsequent calls use cached results. Only triggered when a preset has been "building" past the threshold.
- **No breaking changes** to the response format — the status values are the same, they're just more accurate now.
