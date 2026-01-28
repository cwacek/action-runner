## MODIFIED Requirements

### Requirement: Deploy via CDK construct

The system SHALL provide two AWS CDK stacks for deploying the complete solution: a foundation stack for long-lived infrastructure and secrets, and an application stack for frequently-iterated resources.

#### Scenario: Two-stack deployment
- **WHEN** a user deploys the system for the first time
- **THEN** they first deploy `SpotRunnerFoundationStack` to get the webhook URL and public key
- **AND** then register the GitHub App using those outputs
- **AND** then deploy `SpotRunnerStack` with the GitHub App ID and foundation stack references

#### Scenario: Foundation stack deployment
- **WHEN** a user instantiates `SpotRunnerFoundationStack`
- **THEN** the stack creates VPC, NAT gateway, and runner security group
- **AND** creates an API Gateway REST API with the base webhook URL
- **AND** generates an RSA key pair and stores the private key in Secrets Manager
- **AND** generates a webhook secret and stores it in Secrets Manager
- **AND** outputs the webhook URL, public key (PEM), and webhook secret value for GitHub App registration

#### Scenario: Application stack deployment
- **WHEN** a user instantiates `SpotRunnerStack` with foundation resources and GitHub App ID
- **THEN** the stack deploys all application resources (Lambdas, DynamoDB, Image Builder)
- **AND** imports the API Gateway from foundation and adds the webhook route
- **AND** imports the private key and webhook secret from foundation stack

#### Scenario: Customized CDK deployment
- **WHEN** a user provides optional parameters (custom runner configs, timeout values, spot strategy)
- **THEN** the application stack applies those customizations
- **AND** validates parameter combinations

### Requirement: Secure secrets management

The system SHALL generate and store sensitive configuration (GitHub App private key, webhook secret) in the foundation stack.

#### Scenario: Secrets generation in foundation stack
- **WHEN** the foundation stack is deployed
- **THEN** an RSA 2048-bit key pair is generated via a custom resource Lambda
- **AND** the private key is stored in AWS Secrets Manager with a retention policy
- **AND** the webhook secret is generated using Secrets Manager's generateSecretString
- **AND** the public key is output as a CloudFormation output for GitHub App registration

#### Scenario: Secrets import in application stack
- **WHEN** the application stack is deployed
- **THEN** it imports the private key secret by ARN from the foundation stack
- **AND** it imports the webhook secret by ARN from the foundation stack
- **AND** Lambda has IAM permissions to read both secrets

#### Scenario: Secrets rotation
- **WHEN** a user rotates the GitHub App private key
- **THEN** they update the secret in Secrets Manager
- **AND** upload the new public key to GitHub
- **AND** the system uses the new key on next token generation

### Requirement: Output essential configuration values

The system SHALL output values needed for GitHub App setup from the foundation stack.

#### Scenario: Foundation stack outputs
- **WHEN** foundation stack deployment completes
- **THEN** the stack outputs:
  - Webhook URL (API Gateway base endpoint)
  - Public key (PEM format for GitHub App registration)
  - Webhook secret value (for GitHub App configuration)
  - Private key secret ARN (for application stack reference)
  - Webhook secret ARN (for application stack reference)

#### Scenario: Application stack outputs
- **WHEN** application stack deployment completes
- **THEN** the stack outputs:
  - Lambda function ARN
  - State table name

### Requirement: Application stack required parameters

The system SHALL require only the GitHub App ID and Server URL as external parameters for the application stack.

#### Scenario: Reduced required parameters
- **WHEN** deploying the application stack
- **THEN** only `githubAppId` and `githubServerUrl` are required as external inputs
- **AND** the `githubAppPrivateKey` parameter is removed (imported from foundation)
- **AND** the `webhookSecret` parameter is removed (imported from foundation)

#### Scenario: Foundation stack references required
- **WHEN** deploying the application stack
- **THEN** the `vpc`, `runnerSecurityGroup`, `api`, `privateKeySecret`, and `webhookSecret` properties are required
- **AND** all must reference resources from the foundation stack
