## 1. Foundation Stack - API Gateway

- [ ] 1.1 Add API Gateway REST API to `SpotRunnerFoundationStack`
- [ ] 1.2 Create a `/webhook` resource placeholder (no integration yet)
- [ ] 1.3 Export the API Gateway REST API and webhook URL as stack outputs
- [ ] 1.4 Add `api` property to `SpotRunnerFoundationStack` exports

## 2. Foundation Stack - Key Generation

- [ ] 2.1 Create custom resource Lambda to generate RSA 2048-bit key pair
- [ ] 2.2 Store private key in Secrets Manager with retention policy
- [ ] 2.3 Output public key (PEM format) as CloudFormation output
- [ ] 2.4 Export private key secret as `privateKeySecret` property

## 3. Foundation Stack - Webhook Secret

- [ ] 3.1 Generate webhook secret using `secretsmanager.Secret` with `generateSecretString`
- [ ] 3.2 Output webhook secret value for GitHub App registration
- [ ] 3.3 Export webhook secret as `webhookSecret` property

## 4. Application Stack - Interface Changes

- [ ] 4.1 Remove `githubAppPrivateKey` from `SpotRunnerStackProps`
- [ ] 4.2 Remove `webhookSecret` from `SpotRunnerStackProps`
- [ ] 4.3 Add `api: apigateway.IRestApi` to `SpotRunnerStackProps`
- [ ] 4.4 Add `privateKeySecret: secretsmanager.ISecret` to `SpotRunnerStackProps`
- [ ] 4.5 Add `webhookSecret: secretsmanager.ISecret` to `SpotRunnerStackProps`

## 5. Application Stack - API Gateway Integration

- [ ] 5.1 Remove API Gateway creation from `WebhookHandler` construct
- [ ] 5.2 Update `WebhookHandler` to accept imported API Gateway
- [ ] 5.3 Add POST /webhook route with Lambda integration to imported API

## 6. Application Stack - Secrets Integration

- [ ] 6.1 Remove private key secret creation from `SpotRunnerStack`
- [ ] 6.2 Remove webhook secret creation from `SpotRunnerStack`
- [ ] 6.3 Update Lambda permissions to read imported secrets
- [ ] 6.4 Update Lambda environment variables to use imported secret ARNs

## 7. Entry Point Updates

- [ ] 7.1 Update `bin/app.ts` to remove `githubAppPrivateKey` and `webhookSecret` validation
- [ ] 7.2 Update `bin/app.ts` to pass foundation stack resources to app stack
- [ ] 7.3 Keep `githubAppId` and `githubServerUrl` as required parameters

## 8. Stack Outputs

- [ ] 8.1 Update foundation stack outputs (webhook URL, public key, secret values/ARNs)
- [ ] 8.2 Update application stack outputs (remove webhook URL, keep Lambda ARN, table name)

## 9. Testing

- [ ] 9.1 Update `foundation-stack.test.ts` to verify new resources (API, secrets)
- [ ] 9.2 Update `spot-runner-stack.test.ts` to use mock foundation resources
- [ ] 9.3 Verify cross-stack references work correctly
