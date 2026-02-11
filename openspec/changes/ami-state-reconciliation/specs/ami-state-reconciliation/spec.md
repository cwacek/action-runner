## ADDED Requirements

### Requirement: Stale building states are detected by age threshold
The status handler SHALL identify AMI state records with `status: "building"` and `updatedAt` older than 30 minutes as stale.

#### Scenario: Record is stale
- **WHEN** an AMI state record has `status: "building"` and `updatedAt` is more than 30 minutes ago
- **THEN** the record is flagged for reconciliation

#### Scenario: Record is not stale
- **WHEN** an AMI state record has `status: "building"` and `updatedAt` is less than 30 minutes ago
- **THEN** the record is NOT flagged for reconciliation and is reported as-is

#### Scenario: Non-building records are ignored
- **WHEN** an AMI state record has `status: "ready"` or `status: "failed"`
- **THEN** the record is NOT flagged for reconciliation regardless of age

### Requirement: Stale records are reconciled against Image Builder
The status handler SHALL query the Image Builder API to determine the actual state of a stale preset's pipeline.

#### Scenario: Pipeline lookup by name
- **WHEN** reconciliation is triggered for a preset
- **THEN** the system looks up the Image Builder pipeline with name `spot-runner-${presetName}`

#### Scenario: Latest image from pipeline
- **WHEN** the pipeline ARN is found
- **THEN** the system retrieves the most recent image produced by that pipeline

#### Scenario: Pipeline not found
- **WHEN** no pipeline matches the preset name
- **THEN** the preset status remains unchanged and a warning is logged

### Requirement: Reconciliation corrects DynamoDB and SSM for completed builds
When reconciliation discovers a build that completed successfully, the system SHALL update DynamoDB and SSM to reflect the correct state.

#### Scenario: Build completed successfully
- **WHEN** the latest Image Builder image has state AVAILABLE
- **THEN** DynamoDB AMI state is updated to `"ready"` with the AMI ID
- **AND** the SSM parameter at `/spot-runner/configs/${presetName}` is updated with the new AMI ID

#### Scenario: Build failed
- **WHEN** the latest Image Builder image has state FAILED or CANCELLED
- **THEN** DynamoDB AMI state is updated to `"failed"`
- **AND** the SSM parameter is NOT modified

#### Scenario: Build still in progress
- **WHEN** the latest Image Builder image is still BUILDING, TESTING, or INTEGRATING
- **THEN** DynamoDB state is NOT modified and the preset is reported as `"building"`

### Requirement: Reconciliation results are cached per Lambda invocation
The reconciliation check SHALL be cached in a module-level variable for the lifetime of the Lambda container.

#### Scenario: First invocation triggers reconciliation
- **WHEN** the Lambda container is cold and stale records exist
- **THEN** the Image Builder API is called and results are cached

#### Scenario: Subsequent invocations use cache
- **WHEN** reconciliation has already run on this container
- **THEN** the cached results are used without additional API calls

### Requirement: Reconciliation uses conditional writes
DynamoDB updates from reconciliation SHALL use conditional writes to prevent overwriting newer state.

#### Scenario: Concurrent update during reconciliation
- **WHEN** reconciliation attempts to update a record that has been updated by another process since reconciliation started
- **THEN** the conditional write fails gracefully and the newer state is preserved
