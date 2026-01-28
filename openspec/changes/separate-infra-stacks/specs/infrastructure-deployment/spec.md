## MODIFIED Requirements

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
