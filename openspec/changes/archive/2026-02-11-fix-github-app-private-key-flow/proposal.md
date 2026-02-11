## Why

The previous fix-github-app-catch22 change incorrectly assumed we generate the GitHub App private key ourselves, and that we need the webhook URL before creating the app. In reality: (a) GitHub generates the private key when you create the app, and (b) you can update the webhook URL after app creation. This enables a simpler flow where the app stack outputs the webhook URL.

## What Changes

- **BREAKING**: Remove RSA key pair generation from the foundation stack
- **BREAKING**: Move API Gateway and webhook secret from foundation stack to app stack
- Foundation stack creates only: VPC, security group, and empty private key secret (placeholder)
- App stack creates: API Gateway, webhook secret, and outputs webhook URL + secret for GitHub App configuration
- User creates GitHub App first (without webhook URL), downloads private key, uploads to foundation secret, deploys app stack, then updates GitHub App with the outputted webhook URL and secret
- Status page displays a clear warning when the private key is missing or empty, guiding users to complete the setup

## Capabilities

### New Capabilities

<!-- None - this is a correction to existing functionality -->

### Modified Capabilities

- `infrastructure-deployment`: The foundation stack no longer generates an RSA key pair. Instead, it creates an empty Secrets Manager secret as a placeholder for the GitHub-generated private key. The public key output is removed. The user must upload the private key to Secrets Manager after creating the GitHub App. The status page must display a warning when the private key secret is empty/missing.

## Impact

- **Code**: `SpotRunnerFoundationStack` - remove key generation Lambda, remove API Gateway, remove webhook secret, keep only VPC/SG/empty private key secret
- **Code**: `SpotRunnerStack` - add API Gateway creation, add webhook secret generation, output webhook URL and secret
- **Code**: Status page Lambda - add check for empty/missing private key secret and display warning
- **Spec**: The `infrastructure-deployment` spec needs major updates to reflect the new resource ownership
- **User workflow**: Create GitHub App first → download private key → upload to secret → deploy app stack → update GitHub App with webhook URL/secret
- **Existing deployments**: None exist, so no migration needed
