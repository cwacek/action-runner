## ADDED Requirements

### Requirement: Route jobs by runs-on labels

The system SHALL match `runs-on` labels from workflow jobs to runner configurations.

#### Scenario: Exact label specific
- **WHEN** a job specifies `runs-on: [self-hosted, spotrunner/linux-x64/cpu=2/ram=8]`
- **AND** a configuration exists for `linux-x64`
- **THEN** the system uses that configuration to provision the runner on an instance with at least the specified resources

#### Scenario: Partial label with default fallback
- **WHEN** a job specifies `runs-on: [self-hosted, spotrunner/linux-x64]`
- **THEN** the system uses the default `linux-x64` configuration with a `large` type

#### Scenario: No matching configuration
- **WHEN** a job's labels do not match any configuration
- **THEN** the system does not provision a runner
- **AND** logs the unmatched labels

### Requirement: Store configurations in SSM Parameter Store

The system SHALL store runner configurations in SSM Parameter Store with a hierarchical key structure.

#### Scenario: Configuration retrieval
- **WHEN** the system needs to provision a runner
- **THEN** it looks up the configuration at `/action-runner/configs/<label-key>`
- **AND** parses the JSON configuration

#### Scenario: Configuration structure
- **WHEN** a configuration is stored
- **THEN** it contains:
  - `instanceTypes`: array of EC2 instance types
  - `ami`: AMI ID or "default" for base AMI
  - `diskSizeGb`: root volume size
  - `spotStrategy`: "spotOnly", "spotPreferred", or "onDemandOnly"
  - `timeout`: maximum job duration in seconds
  - `labels`: additional labels to register with GitHub

### Requirement: Label normalization

The system SHALL  look for a specific lable starting with
`spotrunner` and the following syntax `spotrunner/<config>/<opt>,<opt>`

#### Scenario: Label ordering
- **WHEN** labels are `[self-hosted, spotrunner/linux-x64]` or `[self-hosted, spotrunner/linux-x64/ram=4]`
- **THEN** both normalize to the same configuration key
- **AND** `self-hosted` is excluded from the key (it's implicit)

#### Scenario: Case normalization
- **WHEN** labels include mixed case like `Linux` or `X64`
- **THEN** they are normalized to lowercase for lookup

### Requirement: Configuration validation

The system SHALL validate configurations before using them.

#### Scenario: Valid configuration
- **WHEN** a configuration is retrieved
- **AND** it contains all required fields with valid values
- **THEN** the system proceeds with provisioning

#### Scenario: Invalid configuration
- **WHEN** a configuration is missing required fields or has invalid values
- **THEN** the system rejects the job
- **AND** logs the validation error with details
