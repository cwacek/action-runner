## Context

Currently `SpotRunnerStack` is a monolithic CDK stack containing all resources: VPC, security groups, DynamoDB, Secrets Manager, Lambdas, API Gateway, Image Builder pipelines, and EventBridge rules. Destroying this stack takes significant time due to VPC/NAT gateway teardown (~5-10 minutes), which slows iteration during development.

The VPC and security groups are foundational resources that rarely change and don't need to be torn down when iterating on application logic.

## Goals / Non-Goals

**Goals:**
- Separate long-lived infrastructure (VPC, security groups) from frequently-iterated application resources
- Enable rapid iteration on application stack without touching foundation
- Maintain existing functionality and API surface
- Support both new deployments and migration from existing single-stack deployments

**Non-Goals:**
- Changing any application logic or Lambda behavior
- Supporting multiple application stacks per foundation (1:1 relationship)
- Making foundation stack independently useful (it exists to support the app stack)

## Decisions

### Decision 1: Stack names and structure

**Choice**: `SpotRunnerFoundationStack` and `SpotRunnerStack`

- `SpotRunnerFoundationStack`: VPC, NAT gateway, runner security group
- `SpotRunnerStack`: Everything else (DynamoDB, Secrets, Lambdas, API Gateway, Image Builder, etc.)

**Rationale**: Keeping `SpotRunnerStack` as the main app stack name maintains backward compatibility for users who have existing automation referencing it. The foundation stack gets a descriptive suffix.

**Alternatives considered**:
- `InfraStack` / `AppStack`: Too generic, doesn't indicate project
- `NetworkStack` / `SpotRunnerStack`: "Network" undersells what foundation contains (also security groups)

### Decision 2: Cross-stack reference mechanism

**Choice**: CDK cross-stack references via direct property passing

```typescript
const foundation = new SpotRunnerFoundationStack(app, "SpotRunnerFoundationStack", { ... });
new SpotRunnerStack(app, "SpotRunnerStack", {
  vpc: foundation.vpc,
  runnerSecurityGroup: foundation.runnerSecurityGroup,
  ...
});
```

**Rationale**: CDK automatically creates CloudFormation exports/imports when stacks reference each other's resources. This is the idiomatic CDK approach and handles dependency ordering automatically.

**Alternatives considered**:
- Manual CFN exports with `Fn::ImportValue`: More verbose, error-prone, doesn't leverage CDK's type safety
- SSM Parameter Store for sharing: Adds latency and complexity, overkill for static references

### Decision 3: Foundation stack resource composition

**Choice**: Foundation stack contains:
- VPC (with NAT gateway, public/private subnets)
- Runner security group

**Rationale**: These are the slowest resources to create/destroy and the least likely to change. Security groups logically belong with the VPC since they're VPC-scoped.

The Image Builder `BuildSecurityGroup` stays in the app stack because it's created by `RunnerImagePipeline` construct and is tightly coupled to the pipeline lifecycle.

### Decision 4: App stack accepts foundation resources as props

**Choice**: `SpotRunnerStack` requires `vpc` and `runnerSecurityGroup` as mandatory props (no longer creates them internally).

```typescript
interface SpotRunnerStackProps {
  readonly vpc: ec2.IVpc;  // Required, no longer optional
  readonly runnerSecurityGroup: ec2.ISecurityGroup;  // New required prop
  // ... existing props
}
```

**Rationale**: Clean separation of concerns. Foundation owns these resources, app stack consumes them. Removes conditional VPC creation logic from app stack.

**Alternatives considered**:
- Keep optional VPC prop with fallback: Adds complexity, users might accidentally create VPC in app stack
- Pass foundation stack reference: Too coupled, harder to test app stack in isolation

### Decision 5: bin/app.ts orchestration

**Choice**: Instantiate both stacks in `bin/app.ts` with explicit dependency:

```typescript
const foundation = new SpotRunnerFoundationStack(app, "SpotRunnerFoundationStack", {
  env: { account, region },
});

new SpotRunnerStack(app, "SpotRunnerStack", {
  env: { account, region },
  vpc: foundation.vpc,
  runnerSecurityGroup: foundation.runnerSecurityGroup,
  // ... other props
});
```

**Rationale**: Single entry point, clear dependency chain, CDK handles CloudFormation export/import automatically.

## Risks / Trade-offs

**[Risk] Existing deployments can't migrate without full redeploy**
→ Mitigation: Document this clearly. Users with existing single-stack deployments will need to destroy and redeploy, or accept the one-time long destroy cycle. CloudFormation doesn't support moving resources between stacks.

**[Risk] Cross-stack references create deployment coupling**
→ Mitigation: This is intentional - app stack depends on foundation. CDK handles this gracefully. The coupling is loose (just VPC and SG references).

**[Risk] Users might try to destroy app stack while foundation has dependencies**
→ Mitigation: CloudFormation prevents this automatically via export/import dependencies. Clear error message guides users.

**[Trade-off] Two stacks to manage instead of one**
→ Acceptable: The iteration speed benefit outweighs the small complexity increase. Foundation rarely needs attention.

**[Trade-off] Can't share foundation across multiple app stacks**
→ Acceptable: Not a goal. 1:1 relationship is simpler and sufficient for this use case.
