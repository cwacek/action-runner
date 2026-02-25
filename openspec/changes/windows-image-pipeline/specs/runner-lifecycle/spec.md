## MODIFIED Requirements

### Requirement: Register runner with GitHub
The system SHALL register the provisioned instance as a GitHub Actions runner using a JIT registration token.

#### Scenario: Successful runner registration — Linux
- **WHEN** a Linux EC2 instance boots successfully
- **THEN** the instance retrieves the JIT token from user data
- **AND** registers itself with GitHub Enterprise Server as a runner using bash
- **AND** updates its status to "running" in DynamoDB

#### Scenario: Successful runner registration — Windows
- **WHEN** a Windows EC2 instance boots successfully
- **THEN** the instance executes the PowerShell user data script from EC2 `<powershell>` tags
- **AND** decodes the base64-encoded JIT config from the user data
- **AND** registers itself with GitHub Enterprise Server as a runner using `config.cmd`
- **AND** starts the runner via `run.cmd`
- **AND** terminates the instance via `Stop-Computer -Force` after the job completes

#### Scenario: Registration failure — Windows
- **WHEN** runner registration fails on a Windows instance (invalid token, network error, etc.)
- **THEN** the instance logs the error to `C:\runner-bootstrap.log`
- **AND** the instance terminates itself via `Stop-Computer -Force`

### Requirement: Terminate runner after job completion
The system SHALL terminate the EC2 instance after the job completes or times out.

#### Scenario: Job completes successfully — Linux
- **WHEN** the Linux runner completes job execution
- **THEN** the runner deregisters from GitHub
- **AND** the EC2 instance terminates itself
- **AND** the system removes the job-to-instance mapping from DynamoDB

#### Scenario: Job completes successfully — Windows
- **WHEN** the Windows runner completes job execution
- **THEN** the runner exits `run.cmd`
- **AND** the PowerShell script calls `Stop-Computer -Force` to shut down the instance
- **AND** EC2 terminates the instance when it stops (instance-initiated shutdown behavior)

#### Scenario: Spot interruption handling — Windows
- **WHEN** EC2 signals a spot interruption via IMDS (`/latest/meta-data/spot/termination-time`)
- **THEN** the Windows PowerShell bootstrap script detects the interruption via periodic IMDS polling
- **AND** logs the interruption event
- **AND** allows the runner to terminate naturally (EC2 will reclaim the instance)

## ADDED Requirements

### Requirement: Platform-aware user data generation
The system SHALL generate platform-appropriate user data scripts based on the runner's OS platform.

#### Scenario: Linux user data (existing behavior preserved)
- **WHEN** provisioning a runner for a Linux preset
- **THEN** the provisioner calls `generateUserData()` (bash script)
- **AND** the resulting user data is base64-encoded and passed to EC2 `RunInstances`

#### Scenario: Windows user data generation
- **WHEN** provisioning a runner for a Windows preset (where the SSM config includes `platform: "windows"`)
- **THEN** the provisioner calls `generateWindowsUserData()` (PowerShell script)
- **AND** the resulting script is wrapped in `<powershell>...</powershell>` tags
- **AND** the script decodes the base64 JIT config, runs `config.cmd` to register, then runs `run.cmd`
- **AND** the script shuts down the instance via `Stop-Computer -Force` after `run.cmd` exits

#### Scenario: Platform selection in provisioner
- **WHEN** the provisioner reads the runner config from SSM
- **THEN** it checks the `platform` field (defaulting to `"linux"` if absent)
- **AND** selects the appropriate user data generator based on that field
