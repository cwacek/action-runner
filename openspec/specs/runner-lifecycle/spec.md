## ADDED Requirements

### Requirement: Provision runner on job queue

The system SHALL provision a new EC2 instance when a `workflow_job.queued` webhook is received for a job with matching `runs-on` labels.

#### Scenario: Job queued with matching labels
- **WHEN** GitHub sends a `workflow_job.queued` webhook with `runs-on: [self-hosted, linux, x64]`
- **AND** a runner configuration exists for those labels
- **THEN** the system provisions an EC2 instance with the matching configuration from a launch template
- **AND** records the job-to-instance mapping in DynamoDB

#### Scenario: Job queued with no matching configuration
- **WHEN** GitHub sends a `workflow_job.queued` webhook with labels that have no matching configuration
- **THEN** the system logs a warning and does not provision an instance
- **AND** the job remains queued in GitHub (will timeout per GitHub's settings)

### Requirement: Register runner with GitHub

The system SHALL register the provisioned instance as a GitHub Actions runner using a JIT registration token.

#### Scenario: Successful runner registration
- **WHEN** an EC2 instance boots successfully
- **THEN** the instance retrieves the JIT token from user data
- **AND** registers itself with GitHub Enterprise Server as a runner
- **AND** updates its status to "running" in DynamoDB

#### Scenario: Registration failure
- **WHEN** runner registration fails (invalid token, network error, etc.)
- **THEN** the instance logs the error
- **AND** the instance terminates itself
- **AND** the system updates DynamoDB status to "failed"

### Requirement: Terminate runner after job completion

The system SHALL terminate the EC2 instance after the job completes or times out.

#### Scenario: Job completes successfully
- **WHEN** the runner completes job execution
- **THEN** the runner deregisters from GitHub
- **AND** the EC2 instance terminates itself
- **AND** the system removes the job-to-instance mapping from DynamoDB

#### Scenario: Job times out
- **WHEN** a runner has been running longer than the configured timeout
- **THEN** the system forcibly terminates the EC2 instance
- **AND** logs a timeout warning
- **AND** updates DynamoDB status to "timeout"

### Requirement: Handle orphaned instances

The system SHALL detect and terminate instances that become orphaned (no associated job or stuck in provisioning).

#### Scenario: Instance stuck in provisioning
- **WHEN** an instance has been in "pending" state for longer than the provisioning timeout (default: 10 minutes)
- **THEN** the system terminates the instance
- **AND** logs an orphan cleanup event

#### Scenario: Instance with no job mapping
- **WHEN** a periodic cleanup scan finds an instance tagged as a runner but with no DynamoDB entry
- **THEN** the system terminates the instance
- **AND** logs an orphan cleanup event

### Requirement: Idempotent webhook handling

The system SHALL handle duplicate webhooks idempotently using the job ID as a deduplication key.

#### Scenario: Duplicate webhook received
- **WHEN** a `workflow_job.queued` webhook is received for a job ID that already has an instance provisioning or running
- **THEN** the system ignores the duplicate webhook
- **AND** returns a 200 response to GitHub
