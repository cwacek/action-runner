## MODIFIED Requirements

### Requirement: Status endpoint returns system health
The system SHALL expose a `/status` GET endpoint on the existing API Gateway that returns JSON describing system readiness. The overall status SHALL factor in GitHub connectivity in addition to preset readiness. Preset statuses SHALL reflect actual Image Builder pipeline state, not just DynamoDB records, by reconciling stale `building` states.

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

#### Scenario: Stale building preset reconciled to ready
- **WHEN** a preset has been in `"building"` state for more than 30 minutes
- **AND** the Image Builder pipeline shows the build completed successfully
- **THEN** the preset is reported as `"ready"` with the correct AMI ID

#### Scenario: Stale building preset reconciled to failed
- **WHEN** a preset has been in `"building"` state for more than 30 minutes
- **AND** the Image Builder pipeline shows the build failed
- **THEN** the preset is reported as `"failed"`
