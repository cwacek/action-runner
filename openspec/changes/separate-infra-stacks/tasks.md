## 3. Create Foundation Stack

- [ ] 1.1 Create `lib/foundation-stack.ts` with `SpotRunnerFoundationStack` class
- [ ] 1.2 Move VPC creation from `SpotRunnerStack` to foundation stack (with NAT gateway, public/private subnets)
- [ ] 1.3 Move runner security group creation to foundation stack
- [ ] 1.4 Export `vpc` and `runnerSecurityGroup` as public properties on foundation stack

## 2. Modify Application Stack

- [ ] 2.1 Change `vpc` prop from optional to required in `SpotRunnerStackProps`
- [ ] 2.2 Add required `runnerSecurityGroup` prop to `SpotRunnerStackProps`
- [ ] 2.3 Remove VPC creation logic from `SpotRunnerStack` (delete the conditional `props.vpc ?? new ec2.Vpc(...)`)
- [ ] 2.4 Remove runner security group creation from `SpotRunnerStack`
- [ ] 2.5 Update all internal references to use the passed-in `runnerSecurityGroup` prop

## 3. Update Entry Point

- [ ] 3.1 Update `bin/app.ts` to instantiate `SpotRunnerFoundationStack` first
- [ ] 3.2 Update `bin/app.ts` to pass foundation stack's `vpc` and `runnerSecurityGroup` to `SpotRunnerStack`
- [ ] 3.3 Add foundation stack export to `lib/index.ts` (if applicable)

## 4. Update Tests

- [ ] 4.1 Update `test/spot-runner-stack.test.ts` TEST_PROPS to include mock VPC and security group
- [ ] 4.2 Create `test/foundation-stack.test.ts` with basic assertions (VPC created, SG created, exports work)
- [ ] 4.3 Verify all existing tests pass with the new required props

## 5. Verification

- [ ] 5.1 Run `cdk synth` and verify both stacks are generated
- [ ] 5.2 Verify CloudFormation exports are created in foundation stack template
- [ ] 5.3 Verify CloudFormation imports are created in application stack template
- [ ] 5.4 Run full test suite
