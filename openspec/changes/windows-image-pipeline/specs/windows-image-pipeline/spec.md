## ADDED Requirements

### Requirement: WindowsImagePipeline CDK construct
The system SHALL provide a `WindowsImagePipeline` CDK construct in `lib/constructs/windows-image-pipeline.ts` that creates an EC2 Image Builder pipeline for building Windows Server 2022 Core runner AMIs.

#### Scenario: Construct accepts required and optional props
- **WHEN** a user instantiates `WindowsImagePipeline` with required props (`vpc`, `subnet`, `presetName`)
- **THEN** the construct creates all Image Builder resources (components, recipe, infra config, dist config, pipeline) with sensible defaults
- **AND** the construct exposes `pipelineArn` and `imageRecipeArn` as public properties

#### Scenario: Default build configuration
- **WHEN** no optional build props are provided
- **THEN** the build instance type defaults to `c5.2xlarge`
- **AND** the root volume size defaults to 200 GB (gp3)
- **AND** the build schedule defaults to `cron(0 4 ? * SUN *)` (4 AM UTC every Sunday)
- **AND** the runner version defaults to a pinned stable release (e.g., `2.331.0`)
- **AND** the `runnerImagesRef` defaults to a pinned stable tag (e.g., `win22/20250210.1`)

#### Scenario: Custom build configuration
- **WHEN** a user provides optional props (`buildInstanceTypes`, `buildSchedule`, `runnerVersion`, `runnerImagesRef`)
- **THEN** the construct uses those values instead of defaults

### Requirement: Multi-component pipeline structure
The system SHALL split the Windows image build into four separate Image Builder components to allow Windows restarts between phases.

#### Scenario: CloneAndConfigure component
- **WHEN** the pipeline runs phase 1
- **THEN** it clones `actions/runner-images` at the pinned `runnerImagesRef` to `C:\runner-images`
- **AND** runs `Configure-BaseImage.ps1`, `Configure-PowerShell.ps1`, `Install-PowerShellModules.ps1`, `Install-WindowsFeatures.ps1`, `Install-Chocolatey.ps1`
- **AND** the toolset JSON from `actions/runner-images` is in place before any install scripts run

#### Scenario: InstallCoreTools component
- **WHEN** the pipeline runs phase 2
- **THEN** it installs Git, Node.js, .NET SDK, Python, PowerShell Core, and GitHub CLI using the corresponding scripts from `actions/runner-images/images/windows/scripts/build/`
- **AND** a Windows restart is performed after this component completes

#### Scenario: InstallRunner component
- **WHEN** the pipeline runs phase 3
- **THEN** it downloads the GitHub Actions runner zip for the pinned `runnerVersion` to `C:\actions-runner`
- **AND** verifies the SHA256 checksum of the downloaded archive
- **AND** extracts the runner (does NOT configure or register it — that happens at boot via user data)

#### Scenario: Cleanup component
- **WHEN** the pipeline runs phase 4
- **THEN** it runs `Invoke-Cleanup.ps1` and `Configure-System.ps1` from `actions/runner-images`
- **AND** prepares the instance for Sysprep

#### Scenario: Components use ExecutePowerShell action
- **WHEN** any Image Builder component runs on the Windows build instance
- **THEN** all build steps use the `ExecutePowerShell` action (not `ExecuteBash`)
- **AND** SSM Agent executes them locally on the build instance without WinRM

### Requirement: Windows Server 2022 Core parent image
The system SHALL use the AWS-managed Windows Server 2022 Core parent image for the Image Builder recipe.

#### Scenario: Parent image ARN
- **WHEN** the recipe is created
- **THEN** the parent image is `arn:aws:imagebuilder:<region>:aws:image/windows-server-2022-english-core-base/x.x.x`

#### Scenario: x86_64 only
- **WHEN** the pipeline is instantiated
- **THEN** it only supports `x86_64` architecture (Windows arm64 on EC2 is not supported)

### Requirement: AMI tagging for lifecycle integration
The system SHALL tag the produced AMI so the AMI lifecycle system can track it.

#### Scenario: AMI tags
- **WHEN** a Windows AMI is distributed
- **THEN** the AMI is tagged with `Name`, `Runner_Version`, `Preset_Name`, `Platform: windows`
- **AND** the AMI name follows the pattern `spot-runner-<presetName>-{{imagebuilder:buildDate}}`

### Requirement: IAM and networking follow Linux pipeline pattern
The system SHALL create an instance role, instance profile, and build security group following the same pattern as `RunnerImagePipeline`.

#### Scenario: Instance role permissions
- **WHEN** the build instance runs
- **THEN** it has `EC2InstanceProfileForImageBuilder` and `AmazonSSMManagedInstanceCore` managed policies
- **AND** the security group allows all outbound traffic (for downloading packages from Chocolatey, GitHub, etc.)
