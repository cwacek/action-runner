## 1. Extract shared SSM update utility

- [x]1.1 Create `lambda/lib/ssm-config.ts` with `updateSsmConfig(presetName, amiId)` extracted from `lambda/ami-update-handler.ts`
- [x]1.2 Update `lambda/ami-update-handler.ts` to import and use the shared `updateSsmConfig`
- [x]1.3 Verify `npx tsc --noEmit` passes after refactor

## 2. CDK: Add IAM permissions to status handler

- [x]2.1 Add `imagebuilder:ListImagePipelines`, `imagebuilder:ListImagePipelineImages`, `imagebuilder:GetImage` IAM permissions to the status Lambda in `lib/constructs/status-handler.ts`
- [x]2.2 Add `ssm:GetParameter`, `ssm:PutParameter` IAM permissions to the status Lambda (scoped to the config prefix)
- [x]2.3 Add `configPrefix: string` prop to `StatusHandlerProps` and pass as `CONFIG_PREFIX` env var
- [x]2.4 Update `StatusHandler` instantiation in `lib/spot-runner-stack.ts` to pass `configPrefix`
- [x]2.5 Increase status Lambda timeout from 10 seconds to 30 seconds

## 3. Implement reconciliation logic in status handler

- [x]3.1 Add `reconcileStaleBuildingPresets(amiStates)` function in `lambda/status-handler.ts` that identifies stale records (building + updatedAt > 90 min)
- [x]3.2 For each stale preset: call `ListImagePipelines` to find pipeline ARN by name `spot-runner-${presetName}`
- [x]3.3 Call `ListImagePipelineImages` to get the latest image, then `GetImage` to check its state
- [x]3.4 If AVAILABLE: call `upsertAmiState` with ready + AMI ID, then `updateSsmConfig`
- [x]3.5 If FAILED/CANCELLED: call `upsertAmiState` with failed status
- [x]3.6 If still building (BUILDING/TESTING/INTEGRATING): leave unchanged
- [x]3.7 Add module-level cache (`cachedReconciliation`) so reconciliation only runs once per container
- [x]3.8 Wire reconciliation into the handler: run after initial `queryAllAmiStates`, re-query if any records were updated

## 4. Verification

- [x]4.1 Run `npx tsc --noEmit` to verify no type errors
- [x]4.2 Run `npx cdk synth` to verify CDK stack synthesizes correctly
