## ADDED Requirements

### Requirement: Provision spot instances with capacity-optimized allocation

The system SHALL request EC2 spot instances using capacity-optimized allocation strategy to minimize interruption risk.

#### Scenario: Spot instance requested
- **WHEN** a runner needs to be provisioned
- **AND** the spot strategy is `spotOnly` or `spotPreferred`
- **THEN** the system requests a spot instance with capacity-optimized allocation
- **AND** specifies multiple instance types if configured for the runner profile

#### Scenario: Spot capacity unavailable
- **WHEN** a spot instance request fails due to insufficient capacity
- **AND** the spot strategy is `spotPreferred`
- **THEN** the system retries with on-demand instance after configured failures (default: 2)

#### Scenario: Spot-only mode with no capacity
- **WHEN** a spot instance request fails due to insufficient capacity
- **AND** the spot strategy is `spotOnly`
- **THEN** the system does not fall back to on-demand
- **AND** logs the capacity issue
- **AND** the job remains queued

### Requirement: Handle spot interruptions gracefully

The system SHALL detect spot interruption notices and attempt graceful shutdown.

#### Scenario: Spot interruption notice received
- **WHEN** AWS sends a 2-minute spot interruption notice
- **THEN** the runner agent receives the notice via instance metadata polling
- **AND** the runner attempts to cancel the current job gracefully
- **AND** logs the interruption event

#### Scenario: Job interrupted mid-execution
- **WHEN** a spot interruption occurs while a job is running
- **THEN** the system updates DynamoDB with "interrupted" status
- **AND** GitHub marks the job as failed (standard behavior)

### Requirement: Support on-demand fallback

The system SHALL support falling back to on-demand instances when spot capacity is unavailable.

#### Scenario: Fallback to on-demand
- **WHEN** spot requests fail the configured number of times (default: 2)
- **AND** the spot strategy is `spotPreferred`
- **THEN** the system provisions an on-demand instance instead
- **AND** logs that fallback was used

### Requirement: Support multiple availability zones

The system SHALL attempt provisioning across multiple availability zones for resilience.

#### Scenario: Primary AZ unavailable
- **WHEN** the primary availability zone has no capacity
- **THEN** the system attempts provisioning in secondary AZs
- **AND** uses the first AZ with available capacity

### Requirement: Tag instances for tracking

The system SHALL tag all provisioned instances with metadata for tracking and cost allocation.

#### Scenario: Instance tagging
- **WHEN** an EC2 instance is provisioned
- **THEN** the instance is tagged with:
  - `action-runner:job-id` = the GitHub job ID
  - `action-runner:repo` = the repository name
  - `action-runner:workflow` = the workflow name
  - `action-runner:labels` = the runner labels
  - `action-runner:spot-strategy` = the spot strategy used
  - `action-runner:provisioned-at` = ISO timestamp

### Requirement: Respect instance type preferences

The system SHALL use instance types specified in the runner configuration.

#### Scenario: Single instance type configured
- **WHEN** a runner configuration specifies one instance type
- **THEN** the system requests only that instance type

#### Scenario: Multiple instance types configured
- **WHEN** a runner configuration specifies multiple instance types or does not specify.
- **THEN** the system includes all types in the spot request
- **AND** AWS selects the optimal type based on capacity
