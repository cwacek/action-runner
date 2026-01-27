## ADDED Requirements

### Requirement: Deploy via CDK construct

The system SHALL provide an AWS CDK construct for deploying the complete solution.

#### Scenario: Minimal CDK deployment
- **WHEN** a user instantiates the CDK construct with minimal required parameters (GitHub App credentials, VPC)
- **THEN** the construct deploys all required resources with sensible defaults
- **AND** outputs the webhook URL for GitHub App configuration

#### Scenario: Customized CDK deployment
- **WHEN** a user provides optional parameters (custom runner configs, timeout values, spot strategy)
- **THEN** the construct applies those customizations
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

The system SHALL support both user-provided and stack-created VPCs.

#### Scenario: User-provided VPC
- **WHEN** the user specifies existing VPC and subnet IDs
- **THEN** the system launches runners in those subnets
- **AND** does not create VPC resources

#### Scenario: Stack-created VPC
- **WHEN** the user does not specify a VPC
- **THEN** the stack creates a VPC with public subnets
- **AND** configures internet gateway for GitHub connectivity

### Requirement: Output essential configuration values

The system SHALL output values needed for GitHub App setup.

#### Scenario: Stack outputs
- **WHEN** deployment completes
- **THEN** the stack outputs:
  - Webhook URL (API Gateway endpoint)
  - Webhook secret ARN (for retrieval)
  - Lambda function ARN
