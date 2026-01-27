## ADDED Requirements

### Requirement: Status endpoint returns system health
The system SHALL expose a `/status` GET endpoint on the existing API Gateway that returns JSON describing system readiness.

#### Scenario: All presets ready
- **WHEN** all configured presets have valid AMIs
- **THEN** response status is 200 with `{"status": "ready", ...}`

#### Scenario: Presets building
- **WHEN** at least one preset is building and none have failed
- **THEN** response status is 200 with `{"status": "building", ...}`

#### Scenario: System degraded
- **WHEN** at least one preset has failed or has no AMI and none are building
- **THEN** response status is 200 with `{"status": "degraded", ...}`

### Requirement: Status response includes preset details
The status response SHALL include a `presets` array with details for each configured preset.

#### Scenario: Preset details structure
- **WHEN** status endpoint is called
- **THEN** each preset in the response includes `name`, `status`, and `updatedAt` timestamp

#### Scenario: Ready preset details
- **WHEN** a preset has a valid AMI
- **THEN** preset status is `"ready"`
- **AND** the ID of the AMI is NOT displayed

#### Scenario: Building preset details
- **WHEN** a preset's Image Builder pipeline is running and there is no previous AMI
- **THEN** preset status is `"building"`

#### Scenario: Building preset details (update)
- **WHEN** a preset's Image Builder pipeline is running and there was an earlier valid AMI
- **THEN** preset status is `"updating"`

#### Scenario: Failed preset details
- **WHEN** a preset's Image Builder pipeline has failed
- **THEN** preset status is `"failed"`

### Requirement: Status endpoint is unauthenticated
The status endpoint SHALL NOT require authentication to access.

#### Scenario: No auth required
- **WHEN** unauthenticated request is made to `/status`
- **THEN** response is returned without 401/403 error

### Requirement: Status endpoint excludes sensitive information
The status endpoint SHALL NOT expose secrets, repository names, job data, or other sensitive information.

#### Scenario: Response contains only safe data
- **WHEN** status endpoint is called
- **THEN** response contains only preset names, statuses, and timestamps

### Requirement: Status includes human-readable message
The status response SHALL include a `message` field with a human-readable summary.

#### Scenario: Ready message
- **WHEN** all presets are ready
- **THEN** message is "All presets ready"

#### Scenario: Building message
- **WHEN** one preset is building
- **THEN** message indicates building status (e.g., "1 preset building")

#### Scenario: Degraded message
- **WHEN** presets are in degraded state
- **THEN** message indicates the issue (e.g., "1 preset failed")
