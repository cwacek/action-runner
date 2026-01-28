## ADDED Requirements

### Requirement: Deploy via CDK construct

The system SHALL provide two AWS CDK stacks for deploying the complete solution: a foundation stack for long-lived infrastructure and an application stack for frequently-iterated resources.

#### Scenario: Two-stack deployment
- **WHEN** a user deploys the system
- **THEN** they first deploy `SpotRunnerFoundationStack` with VPC configuration
- **AND** then deploy `SpotRunnerStack` with GitHub App credentials and foundation stack references

#### Scenario: Foundation stack deployment
- **WHEN** a user instantiates `SpotRunnerFoundationStack`
- **THEN** the stack creates VPC, NAT gateway, and runner security group
- **AND** exports these resources for the application stack

#### Scenario: Application stack deployment
- **WHEN** a user instantiates `SpotRunnerStack` with foundation resources and GitHub App credentials
- **THEN** the stack deploys all application resources (Lambdas, DynamoDB, API Gateway, Image Builder)
- **AND** outputs the webhook URL for GitHub App configuration

#### Scenario: Customized CDK deployment
- **WHEN** a user provides optional parameters (custom runner configs, timeout values, spot strategy)
- **THEN** the application stack applies those customizations
- **AND** validates parameter combinations

### Requirement: Minimal required configuration

The system SHALL require only essential configuration for deployment.

#### Scenario: Required parameters only
- **WHEN** deploying with only required parameters
- **THEN** the system provisions successfully with these defaults:
  - Spot strategy: `spotPreferred`
  - Fallback retries: 2
  - Job timeout: 1 hours
  - Provisioning timeout: 10 minutes
  - Default runner config: `m5.large`, Amazon Linux 2023

### Requirement: Secure secrets management

The system SHALL store sensitive configuration (GitHub App private key, webhook secret) securely.

#### Scenario: Secrets in Secrets Manager
- **WHEN** the stack is deployed
- **THEN** GitHub App private key is stored in AWS Secrets Manager
- **AND** webhook secret is stored in AWS Secrets Manager
- **AND** Lambda has IAM permissions to read only required secrets

#### Scenario: Secrets rotation
- **WHEN** a user rotates the GitHub App private key
- **THEN** they update the secret in Secrets Manager
- **AND** the system uses the new key on next token generation

### Requirement: IAM least privilege

The system SHALL create IAM roles with minimal required permissions.

#### Scenario: Lambda execution role
- **WHEN** the Lambda function executes
- **THEN** it has permissions only for:
  - DynamoDB read/write to its table
  - EC2 RunInstances, TerminateInstances, DescribeInstances for
    instances it made itself (using tag logic).
  - Secrets Manager read for its secrets
  - SSM Parameter Store read for runner configs
  - CloudWatch Logs write

#### Scenario: EC2 instance profile
- **WHEN** a runner instance executes
- **THEN** it has permissions only for:
  - EC2 TerminateInstances (for self-termination)
  - CloudWatch Logs write
  - Secrets Manager read (for JIT token if not in user data)

### Requirement: VPC configuration options

The system SHALL require VPC and security group to be provided from the foundation stack.

#### Scenario: Foundation-provided VPC
- **WHEN** the application stack is instantiated
- **THEN** the `vpc` property is required and must reference the foundation stack's VPC
- **AND** the `runnerSecurityGroup` property is required and must reference the foundation stack's security group

#### Scenario: No VPC creation in application stack
- **WHEN** the application stack is deployed
- **THEN** it does not create any VPC resources
- **AND** it uses the VPC and subnets from the foundation stack for all resources

### Requirement: Output essential configuration values

The system SHALL output values needed for GitHub App setup.

#### Scenario: Stack outputs
- **WHEN** deployment completes
- **THEN** the stack outputs:
  - Webhook URL (API Gateway endpoint)
  - Webhook secret ARN (for retrieval)
  - Lambda function ARN

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
