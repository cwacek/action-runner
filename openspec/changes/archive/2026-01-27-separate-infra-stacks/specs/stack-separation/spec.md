## ADDED Requirements

### Requirement: Foundation stack contains long-lived infrastructure

The system SHALL provide a `SpotRunnerFoundationStack` CDK stack that contains infrastructure resources that are slow to create/destroy and rarely change.

#### Scenario: Foundation stack resources
- **WHEN** the foundation stack is deployed
- **THEN** it creates a VPC with public and private subnets
- **AND** it creates a NAT gateway for private subnet egress
- **AND** it creates a security group for runner instances

#### Scenario: Foundation stack exports
- **WHEN** the foundation stack deployment completes
- **THEN** it exports the VPC as a property accessible to dependent stacks
- **AND** it exports the runner security group as a property accessible to dependent stacks

### Requirement: Application stack consumes foundation resources

The system SHALL require the `SpotRunnerStack` to receive VPC and security group from the foundation stack rather than creating them internally.

#### Scenario: Required foundation props
- **WHEN** instantiating `SpotRunnerStack`
- **THEN** the `vpc` property is required (not optional)
- **AND** the `runnerSecurityGroup` property is required

#### Scenario: No internal VPC creation
- **WHEN** `SpotRunnerStack` is instantiated with foundation resources
- **THEN** it does not create any VPC resources
- **AND** it does not create the runner security group

### Requirement: Cross-stack dependency ordering

The system SHALL enforce that the application stack depends on the foundation stack.

#### Scenario: Automatic dependency via CDK
- **WHEN** `bin/app.ts` instantiates both stacks with resource references
- **THEN** CDK automatically creates CloudFormation exports in the foundation stack
- **AND** CDK automatically creates CloudFormation imports in the application stack
- **AND** CloudFormation deploys foundation before application

#### Scenario: Destruction ordering
- **WHEN** a user attempts to destroy the foundation stack while the application stack exists
- **THEN** CloudFormation fails with a dependency error
- **AND** the user must destroy the application stack first

### Requirement: Independent stack destruction

The system SHALL allow the application stack to be destroyed without affecting the foundation stack.

#### Scenario: App stack destruction preserves foundation
- **WHEN** a user runs `cdk destroy SpotRunnerStack`
- **THEN** all application resources are deleted
- **AND** the VPC remains intact
- **AND** the security group remains intact
- **AND** the foundation stack remains deployable

#### Scenario: Rapid iteration cycle
- **WHEN** a user destroys and redeploys only the application stack
- **THEN** the operation completes without VPC/NAT gateway recreation time
