## 1. Foundation Stack - API Gateway

- [x] 1.1 Add API Gateway REST API to `SpotRunnerFoundationStack`
- [x] 1.2 Create a `/webhook` resource placeholder (no integration yet)
- [x] 1.3 Export the API Gateway REST API and webhook URL as stack outputs
- [x] 1.4 Add `api` property to `SpotRunnerFoundationStack` exports

## 2. Foundation Stack - Key Generation

- [x] 2.1 Create custom resource Lambda to generate RSA 2048-bit key pair
- [x] 2.2 Store private key in Secrets Manager with retention policy
- [x] 2.3 Output public key (PEM format) as CloudFormation output
- [x] 2.4 Export private key secret as `privateKeySecret` property

## 3. Foundation Stack - Webhook Secret

- [x] 3.1 Generate webhook secret using `secretsmanager.Secret` with `generateSecretString`
- [x] 3.2 Output webhook secret value for GitHub App registration
- [x] 3.3 Export webhook secret as `webhookSecret` property

## 4. Application Stack - Interface Changes

- [x] 4.1 Remove `githubAppPrivateKey` from `SpotRunnerStackProps`
- [x] 4.2 Remove `webhookSecret` from `SpotRunnerStackProps`
- [x] 4.3 Add `api: apigateway.RestApi` to `SpotRunnerStackProps`
- [x] 4.4 Add `privateKeySecret: secretsmanager.ISecret` to `SpotRunnerStackProps`
- [x] 4.5 Add `webhookSecret: secretsmanager.ISecret` to `SpotRunnerStackProps`

## 5. Application Stack - API Gateway Integration

- [x] 5.1 Remove API Gateway creation from `WebhookHandler` construct
- [x] 5.2 Update `WebhookHandler` to accept imported API Gateway
- [x] 5.3 Add POST /webhook route with Lambda integration to imported API

## 6. Application Stack - Secrets Integration

- [x] 6.1 Remove private key secret creation from `SpotRunnerStack`
- [x] 6.2 Remove webhook secret creation from `SpotRunnerStack`
- [x] 6.3 Update Lambda permissions to read imported secrets
- [x] 6.4 Update Lambda environment variables to use imported secret ARNs

## 7. Entry Point Updates

- [x] 7.1 Update `bin/app.ts` to remove `githubAppPrivateKey` and `webhookSecret` validation
- [x] 7.2 Update `bin/app.ts` to pass foundation stack resources to app stack
- [x] 7.3 Keep `githubAppId` and `githubServerUrl` as required parameters

## 8. Stack Outputs

- [x] 8.1 Update foundation stack outputs (webhook URL, public key, secret values/ARNs)
- [x] 8.2 Update application stack outputs (remove webhook URL, keep Lambda ARN, table name)

## 9. Testing

- [x] 9.1 Update `foundation-stack.test.ts` to verify new resources (API, secrets)
- [x] 9.2 Update `spot-runner-stack.test.ts` to use mock foundation resources
- [x] 9.3 Verify cross-stack references work correctly
