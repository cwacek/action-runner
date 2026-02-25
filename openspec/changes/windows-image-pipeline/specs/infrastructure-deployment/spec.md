## MODIFIED Requirements

### Requirement: Runner presets replace default runner config
The system SHALL replace `defaultRunnerConfig` with a `presets` array where each preset defines a complete runner configuration coupled with its Image Builder pipeline.

#### Scenario: Preset-based configuration
- **WHEN** a user deploys the stack with a `presets` array
- **THEN** each preset creates:
  - An Image Builder pipeline for the runner image (Linux or Windows, based on `platform`)
  - An SSM parameter at `/spot-runner/configs/<preset-name>`
  - A DynamoDB record tracking AMI build state

#### Scenario: Preset configuration structure
- **WHEN** defining a preset
- **THEN** the preset includes:
  - `name`: Unique identifier for the preset
  - `architecture`: CPU architecture (`x86_64` or `arm64`)
  - `platform`: OS platform (`"linux"` or `"windows"`), defaulting to `"linux"`
  - `instanceTypes`: Array of EC2 instance types (optional, can be tag-based)
  - `labels`: Additional labels for workflow matching (optional)
  - `additionalDockerImages`: Images to pre-pull — only valid for Linux presets (optional)
  - `timeout`: Job timeout override (optional)

#### Scenario: Single source of truth
- **WHEN** a preset is defined in CDK
- **THEN** both the Image Builder component recipe and SSM runner config derive from the same preset definition
- **AND** users do not manually edit SSM parameters

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

#### Scenario: Windows preset with arm64
- **WHEN** a preset has `platform: "windows"` and `architecture: "arm64"`
- **THEN** CDK synthesis fails with a clear error message indicating Windows arm64 is not supported

#### Scenario: Windows preset with additionalDockerImages
- **WHEN** a preset has `platform: "windows"` and a non-empty `additionalDockerImages` array
- **THEN** CDK synthesis fails with a clear error message indicating Docker is not supported on Windows presets

## ADDED Requirements

### Requirement: Platform-based pipeline routing in stack
The system SHALL instantiate `WindowsImagePipeline` instead of `RunnerImagePipeline` when a preset specifies `platform: "windows"`.

#### Scenario: Linux preset routing (existing behavior preserved)
- **WHEN** a preset has `platform: "linux"` or no `platform` field
- **THEN** the stack creates a `RunnerImagePipeline` for that preset

#### Scenario: Windows preset routing
- **WHEN** a preset has `platform: "windows"`
- **THEN** the stack creates a `WindowsImagePipeline` for that preset instead of `RunnerImagePipeline`
- **AND** the `WindowsImagePipeline` receives the same `vpc`, `subnet`, and `presetName` props

#### Scenario: SSM parameter includes platform
- **WHEN** an SSM parameter is created for a preset
- **THEN** it includes the `platform` field (`"linux"` or `"windows"`)
- **AND** the provisioner reads this field to determine which user data generator to use

### Requirement: WindowsImagePipeline exported from constructs index
The system SHALL export `WindowsImagePipeline` from `lib/constructs/index.ts` for use in the stack and external reuse.

#### Scenario: Export available
- **WHEN** a consumer imports from `lib/constructs`
- **THEN** `WindowsImagePipeline` and `WindowsImagePipelineProps` are available named exports
