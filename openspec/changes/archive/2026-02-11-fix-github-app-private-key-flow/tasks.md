## 1. Foundation Stack Cleanup

- [x]1.1 Remove `KeyGenerator` construct from `lib/constructs/key-generator.ts`
- [x]1.2 Remove `KeyGenerator` export from `lib/constructs/index.ts`
- [x]1.3 Remove API Gateway creation from `SpotRunnerFoundationStack`
- [x]1.4 Remove webhook secret creation from `SpotRunnerFoundationStack`
- [x]1.5 Replace `KeyGenerator` usage with simple placeholder secret in foundation stack
- [x]1.6 Remove `api`, `webhookUrl`, `webhookSecret`, `publicKey`, `apiRootResourceId` properties from foundation stack
- [x]1.7 Update foundation stack outputs (remove webhook URL, public key, webhook secret ARN; keep private key ARN)

## 2. Application Stack - API Gateway

- [x]2.1 Add API Gateway REST API creation to `SpotRunnerStack`
- [x]2.2 Add webhook endpoint route with Lambda integration
- [x]2.3 Add health check endpoint
- [x]2.4 Output webhook URL from app stack

## 3. Application Stack - Webhook Secret

- [x]3.1 Add webhook secret generation in `SpotRunnerStack`
- [x]3.2 Output webhook secret value from app stack
- [x]3.3 Pass webhook secret to webhook handler Lambda

## 4. Application Stack - Props Update

- [x]4.1 Remove `api`, `webhookSecret` from `SpotRunnerStackProps` (no longer passed from foundation)
- [x]4.2 Update `bin/app.ts` to remove API Gateway and webhook secret references from foundation stack

## 5. Status Handler - Configuration Check

- [x]5.1 Add `PRIVATE_KEY_SECRET_ARN` environment variable to status handler Lambda
- [x]5.2 Implement private key configuration check in `status-handler.ts`
- [x]5.3 Add `configuration.privateKeyConfigured` field to status response
- [x]5.4 Update `aggregateStatus` to return `degraded` when private key not configured
- [x]5.5 Update `generateMessage` to include private key warning

## 6. Webhook Handler - Fail Fast

- [x]6.1 Add private key configuration check at webhook handler startup
- [x]6.2 Return 503 with clear error message if private key is placeholder

## 7. Tests

- [x]7.1 Update `foundation-stack.test.ts` - remove API Gateway and key generator tests
- [x]7.2 Add foundation stack test for placeholder private key secret
- [x]7.3 Update `spot-runner-stack.test.ts` - add API Gateway and webhook secret tests
- [x]7.4 Add status handler test for unconfigured private key detection
- [x]7.5 Add webhook handler test for 503 on missing private key

## 8. Cleanup

- [x]8.1 Delete `lib/constructs/key-generator.ts`
- [x]8.2 Run `npm run build` to verify no TypeScript errors
- [x]8.3 Run `npm test` to verify all tests pass
- [x]8.4 Run `cdk synth` to verify stacks synthesize correctly
