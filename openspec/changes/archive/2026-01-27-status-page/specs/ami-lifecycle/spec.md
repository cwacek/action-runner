## ADDED Requirements

### Requirement: AMI state tracked in DynamoDB
The system SHALL store AMI build state in the existing DynamoDB table using a dedicated item type.

#### Scenario: AMI state record structure
- **WHEN** an AMI state record exists
- **THEN** it has PK `AMI#<preset-name>`, SK `LATEST`, and contains `amiId`, `status`, `updatedAt`, and `buildId` fields

#### Scenario: Initial state on deploy
- **WHEN** a preset is deployed for the first time
- **THEN** an AMI state record is created with status `"building"` and null `amiId`

### Requirement: EventBridge captures Image Builder completion
The system SHALL create an EventBridge rule that triggers on Image Builder image state changes.

#### Scenario: Rule matches successful builds
- **WHEN** Image Builder completes successfully (state AVAILABLE)
- **THEN** EventBridge rule triggers the AMI update Lambda

#### Scenario: Rule matches failed builds
- **WHEN** Image Builder fails
- **THEN** EventBridge rule triggers the AMI update Lambda to record failure

### Requirement: AMI update Lambda processes build events
The system SHALL have a Lambda function that processes Image Builder completion events.

#### Scenario: Successful build processing
- **WHEN** Lambda receives a successful build event
- **THEN** Lambda extracts AMI ID from event, updates DynamoDB state to `"ready"`, and updates SSM parameter

#### Scenario: Failed build processing
- **WHEN** Lambda receives a failed build event
- **THEN** Lambda updates DynamoDB state to `"failed"` without changing SSM parameter

#### Scenario: Conditional update prevents race conditions
- **WHEN** Lambda processes an event with an older timestamp than current state
- **THEN** Lambda does not overwrite newer state (conditional write)

### Requirement: SSM parameters auto-updated on AMI completion
The system SHALL automatically update SSM parameters when a new AMI becomes available.

#### Scenario: SSM updated with new AMI
- **WHEN** Image Builder produces a new AMI
- **THEN** the corresponding SSM parameter at `/spot-runner/configs/<preset-name>` is updated with the new AMI ID

#### Scenario: SSM preserves other config values
- **WHEN** SSM parameter is updated with new AMI ID
- **THEN** all other configuration values (instanceTypes, timeout, etc.) are preserved

#### Scenario: SSM not updated on failure
- **WHEN** Image Builder fails
- **THEN** SSM parameter retains the previous AMI ID (if any)

### Requirement: Image Builder triggered on schedule with immediate first run
The system SHALL configure Image Builder pipelines with a schedule and trigger an immediate build on deployment.

#### Scenario: Pipeline has schedule
- **WHEN** preset is deployed
- **THEN** Image Builder pipeline is configured with a recurring schedule

#### Scenario: Immediate build on deploy
- **WHEN** stack is deployed with a new preset
- **THEN** Image Builder pipeline execution is triggered immediately (not blocking deployment)

### Requirement: Preset configuration stored for AMI Lambda access
The system SHALL store preset configurations in a way accessible to the AMI update Lambda.

#### Scenario: Preset config accessible
- **WHEN** AMI update Lambda needs to write SSM parameter
- **THEN** Lambda can retrieve the preset configuration (instanceTypes, timeout, labels, etc.)
