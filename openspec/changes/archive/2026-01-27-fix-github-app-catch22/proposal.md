## Why

The github app implementation is a catch-22? To register a GH app, it already needs a valid endpoint,
so requiring our stack to have it at deploy time is impossible as it stands.

## What Changes

- Setting up endpoints for the app happen as part of the foundation stack
- The app stack continues to require githubServerUrl, githubAppId, webhookSecret
- The githubAppPrivateKey is generated as part of the foundation stack and used by the app stack.

## Capabilities

### New Capabilities

<!-- None - modification to existing functionality -->

### Modified Capabilities

- `infrastructure-deployment`: The foundation stack now deploys an endpoint and outputs it, and generates a referencable private key.

## Impact

- **Code**: `bin/app.ts` adjusted to take different parameters and pass them differently.
- **Testing**: Stack tests may need adjustment to handle cross-stack dependencies
- **Existing deployments**: Don't worry about them, there aren't any.

