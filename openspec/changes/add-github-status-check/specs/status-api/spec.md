## ADDED Requirements

### Requirement: Status response includes GitHub connectivity section
The status response SHALL include a `github` object reporting the result of the GitHub App connectivity check.

#### Scenario: GitHub section structure
- **WHEN** the status endpoint is called
- **THEN** the response includes a `github` object with `status` and `message` fields

#### Scenario: GitHub connected
- **WHEN** the GitHub connectivity check succeeds
- **THEN** `github.status` is `"connected"` and `github.appSlug` contains the App slug

#### Scenario: GitHub auth error
- **WHEN** the GitHub connectivity check fails with an authentication error
- **THEN** `github.status` is `"auth_error"` and `github.message` describes the error

#### Scenario: GitHub unreachable
- **WHEN** the GitHub server cannot be reached
- **THEN** `github.status` is `"unreachable"` and `github.message` describes the network error

#### Scenario: GitHub error
- **WHEN** the GitHub connectivity check fails with an unexpected error
- **THEN** `github.status` is `"error"` and `github.message` describes the issue

## MODIFIED Requirements

### Requirement: Status endpoint returns system health
The system SHALL expose a `/status` GET endpoint on the existing API Gateway that returns JSON describing system readiness. The overall status SHALL factor in GitHub connectivity in addition to preset readiness.

#### Scenario: All presets ready
- **WHEN** all configured presets have valid AMIs
- **AND** the GitHub connectivity check returns `"connected"`
- **THEN** response status is 200 with `{"status": "ready", ...}`

#### Scenario: Presets building
- **WHEN** at least one preset is building and none have failed
- **AND** the GitHub connectivity check returns `"connected"`
- **THEN** response status is 200 with `{"status": "building", ...}`

#### Scenario: System degraded
- **WHEN** at least one preset has failed or has no AMI and none are building
- **THEN** response status is 200 with `{"status": "degraded", ...}`

#### Scenario: System degraded due to GitHub connectivity
- **WHEN** the GitHub connectivity status is not `"connected"`
- **THEN** the overall system status is `"degraded"` regardless of preset readiness

### Requirement: Status includes human-readable message
The status response SHALL include a `message` field with a human-readable summary. The message SHALL include GitHub connectivity issues when applicable.

#### Scenario: Ready message
- **WHEN** all presets are ready and GitHub is connected
- **THEN** message is "All presets ready"

#### Scenario: Building message
- **WHEN** one preset is building
- **THEN** message indicates building status (e.g., "1 preset building")

#### Scenario: Degraded message
- **WHEN** presets are in degraded state
- **THEN** message indicates the issue (e.g., "1 preset failed")

#### Scenario: GitHub connectivity issue in message
- **WHEN** the GitHub connectivity check is not `"connected"`
- **THEN** message includes the GitHub connectivity issue (e.g., "GitHub API authentication failed")

### Requirement: Status endpoint excludes sensitive information
The status endpoint SHALL NOT expose secrets, repository names, job data, or other sensitive information. The GitHub connectivity section SHALL only expose the App slug and diagnostic messages, not tokens or keys.

#### Scenario: Response contains only safe data
- **WHEN** status endpoint is called
- **THEN** response contains only preset names, statuses, timestamps, and GitHub connectivity status
- **AND** no JWT tokens, private keys, or installation tokens are included in the response
