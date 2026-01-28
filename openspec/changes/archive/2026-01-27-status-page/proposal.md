## Why

Currently, Image Builder and the webhook handler are independent systems. Users must manually trigger AMI builds, wait for completion, copy the AMI ID, and update SSM configurations. This multi-step process is error-prone and makes initial setup confusing. The desired experience is: deploy CloudFormation → check status URL → wait until "ready" → done.

## What Changes

- **Tightly couple Image Builder with webhook handler**: The stack defines image configurations that are known to both systems. When Image Builder produces a new AMI, the corresponding SSM config is automatically updated.
- **Add status API endpoint**: A new `/status` endpoint returns configuration health - which presets exist and whether they have valid AMIs (are "ready"). No authentication required for this read-only, non-sensitive data.
- **Auto-update AMI IDs**: When Image Builder completes a build, an EventBridge rule triggers a Lambda that updates the SSM parameter with the new AMI ID.
- **Unified configuration model**: Runner configurations are defined in CDK props (not manually in SSM), and the stack manages both the Image Builder pipeline and SSM parameters together.

## Capabilities

### New Capabilities
- `status-api`: HTTP endpoint that returns system health and configuration readiness. Shows preset names, AMI status (ready/building/none), and overall system state.
- `ami-lifecycle`: Automated AMI management - tracks Image Builder outputs, updates SSM configs on completion, provides AMI status to other components.

### Modified Capabilities
- `infrastructure-deployment`: Runner configurations move from manual SSM setup to CDK-defined presets. Stack creates both Image Builder pipelines and SSM parameters from the same config.

## Impact

- **API Gateway**: New `/status` route added to existing API
- **Lambda**: New status handler function; new AMI update handler triggered by EventBridge
- **EventBridge**: New rule to capture Image Builder completion events
- **SSM Parameters**: Now managed by CDK and auto-updated (users should not manually edit)
- **CDK Props**: New `runnerPresets` configuration array replaces manual SSM setup
- **README**: Setup instructions simplified; manual AMI step removed
