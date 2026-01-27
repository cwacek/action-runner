## ADDED Requirements

### Requirement: GitHub App authentication

The system SHALL authenticate with GitHub Enterprise Server as a GitHub App using app credentials (App ID and private key).

#### Scenario: Generate installation access token
- **WHEN** the system needs to call GitHub APIs
- **THEN** it generates a JWT signed with the App private key
- **AND** exchanges the JWT for an installation access token
- **AND** caches the token until near expiration (tokens last 1 hour)

#### Scenario: Token refresh on expiration
- **WHEN** a cached installation token is within 5 minutes of expiration
- **THEN** the system refreshes the token before the next API call

### Requirement: Receive workflow job webhooks

The system SHALL expose an HTTPS endpoint to receive `workflow_job` webhooks from GitHub Enterprise Server.

#### Scenario: Valid webhook received
- **WHEN** GitHub sends a `workflow_job` webhook with a valid signature
- **THEN** the system verifies the signature using the webhook secret
- **AND** processes the webhook payload
- **AND** returns HTTP 200

#### Scenario: Invalid webhook signature
- **WHEN** a request is received with an invalid or missing webhook signature
- **THEN** the system rejects the request with HTTP 401
- **AND** logs the rejection

#### Scenario: Webhook for irrelevant action
- **WHEN** a `workflow_job` webhook is received with action other than `queued` (e.g., `in_progress`, `completed`)
- **THEN** the system acknowledges with HTTP 200
- **AND** takes no provisioning action

### Requirement: Request JIT runner registration tokens

The system SHALL request Just-in-Time runner registration tokens from the GitHub API for each new runner.

#### Scenario: Successful JIT token request
- **WHEN** provisioning a new runner for a queued job
- **THEN** the system calls the GitHub API to generate a JIT registration token
- **AND** includes the token in the EC2 instance user data (encrypted)

#### Scenario: JIT token request failure
- **WHEN** the GitHub API returns an error when requesting a JIT token
- **THEN** the system logs the error with details
- **AND** does not provision an instance
- **AND** the job remains queued for retry

