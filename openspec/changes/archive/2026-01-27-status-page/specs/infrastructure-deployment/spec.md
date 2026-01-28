## MODIFIED Requirements

### Requirement: Runner presets replace default runner config

The system SHALL replace `defaultRunnerConfig` with a `presets` array where each preset defines a complete runner configuration coupled with its Image Builder pipeline.

#### Scenario: Preset-based configuration
- **WHEN** a user deploys the stack with a `presets` array
- **THEN** each preset creates:
  - An Image Builder pipeline for the runner image
  - An SSM parameter at `/spot-runner/configs/<preset-name>`
  - A DynamoDB record tracking AMI build state

#### Scenario: Preset configuration structure
- **WHEN** defining a preset
- **THEN** the preset includes:
  - `name`: Unique identifier for the preset
  - `architecture`: CPU architecture (`x86_64` or `arm64`)
  - `instanceTypes`: Array of EC2 instance types (optional, can be tag-based)
  - `labels`: Additional labels for workflow matching (optional)
  - `additionalDockerImages`: Images to pre-pull (optional)
  - `timeout`: Job timeout override (optional)

#### Scenario: Single source of truth
- **WHEN** a preset is defined in CDK
- **THEN** both the Image Builder component recipe and SSM runner config derive from the same preset definition
- **AND** users do not manually edit SSM parameters

### Requirement: SSM parameters managed by stack

The system SHALL create and manage SSM parameters for runner configurations, replacing manual SSM setup.

#### Scenario: SSM parameter creation on deploy
- **WHEN** the stack deploys with a preset
- **THEN** an SSM parameter is created at `/spot-runner/configs/<preset-name>`
- **AND** the parameter contains a placeholder AMI ID initially

#### Scenario: SSM parameter structure
- **WHEN** the SSM parameter is read
- **THEN** it contains JSON with `amiId`, `instanceTypes`, `labels`, `timeout`, and other preset config values

#### Scenario: No manual SSM editing required
- **WHEN** the system is deployed and operational
- **THEN** users never need to manually update SSM parameters
- **AND** AMI IDs are automatically populated by the AMI lifecycle system

### Requirement: Preset validation

The system SHALL validate preset configurations at synthesis time.

#### Scenario: Duplicate preset names
- **WHEN** two presets have the same name
- **THEN** CDK synthesis fails with a clear error message

#### Scenario: Invalid architecture
- **WHEN** a preset specifies an unsupported architecture
- **THEN** CDK synthesis fails with a clear error message

#### Scenario: Empty presets array
- **WHEN** the presets array is empty and no defaultRunnerConfig is provided
- **THEN** CDK synthesis fails indicating at least one runner configuration is required
