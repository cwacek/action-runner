## Why

Destroying the current monolithic stack takes a long time due to VPC/NAT gateway teardown, which kills iteration speed during development. VPC and security groups rarely change and shouldn't need to be torn down when iterating on application logic.

## What Changes

- Split `SpotRunnerStack` into two CDK stacks:
  - `FoundationStack`: VPC, NAT gateway, security groups (long-lived, rarely destroyed)
  - `SpotRunnerStack`: All application resources (Lambdas, DynamoDB, API Gateway, Image Builder, etc.)
- Add cross-stack references so app stack imports VPC and security groups from foundation
- Update `bin/app.ts` to instantiate both stacks with proper dependency ordering
- Foundation stack can be deployed once and left alone; app stack can be rapidly iterated

## Capabilities

### New Capabilities

- `stack-separation`: Defines the two-stack architecture, what belongs in each stack, and cross-stack reference patterns

### Modified Capabilities

- `infrastructure-deployment`: Deployment now involves two stacks instead of one; users need to understand the dependency and deployment order

## Impact

- **Code**: `lib/spot-runner-stack.ts` split into `lib/foundation-stack.ts` and modified `lib/spot-runner-stack.ts`
- **Deployment**: `cdk deploy` pattern changes - foundation deploys first, then app stack
- **Destruction**: `cdk destroy SpotRunnerStack` leaves foundation intact; explicit `cdk destroy FoundationStack` required to fully tear down
- **Testing**: Stack tests may need adjustment to handle cross-stack dependencies
- **Existing deployments**: Users with existing single-stack deployments will need migration guidance (or accept full redeploy)
