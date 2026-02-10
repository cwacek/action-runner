## ADDED Requirements

### Requirement: GitHub connectivity check authenticates with GitHub API
The status handler SHALL generate a JWT using the configured App ID and private key, then call `GET {serverUrl}/api/v3/app` to verify the full authentication chain.

#### Scenario: Successful authentication
- **WHEN** the App ID is valid, the private key is correct, and the GitHub server is reachable
- **THEN** the GitHub API returns HTTP 200 with App metadata
- **AND** the connectivity status is `"connected"`

#### Scenario: Authentication failure
- **WHEN** the GitHub server is reachable but returns HTTP 401 or 403
- **THEN** the connectivity status is `"auth_error"`
- **AND** the message includes the HTTP status code and response body

#### Scenario: Server unreachable
- **WHEN** the GitHub server cannot be reached (DNS failure, connection refused, timeout, TLS error)
- **THEN** the connectivity status is `"unreachable"`
- **AND** the message describes the network error

#### Scenario: Unexpected error
- **WHEN** the GitHub server returns an unexpected HTTP status (5xx or other non-200/401/403)
- **THEN** the connectivity status is `"error"`
- **AND** the message includes the HTTP status code

#### Scenario: Private key not configured
- **WHEN** the private key secret is a placeholder or not configured
- **THEN** the connectivity check SHALL be skipped
- **AND** the connectivity status is `"error"` with message indicating the private key is not configured

### Requirement: GitHub connectivity result is cached per Lambda invocation
The connectivity check result SHALL be cached in a module-level variable for the lifetime of the Lambda container, following the same pattern as the private key configuration check.

#### Scenario: First invocation on cold start
- **WHEN** the Lambda container is cold (no cached result)
- **THEN** the system makes an API call to GitHub and caches the result

#### Scenario: Subsequent invocation on warm container
- **WHEN** a cached connectivity result exists from a prior invocation
- **THEN** the cached result is returned without making a new API call

### Requirement: GitHub connectivity response includes App identity
When the connectivity check succeeds, the response SHALL include the App's slug from the GitHub API response to confirm which App is configured.

#### Scenario: Connected response includes appSlug
- **WHEN** the connectivity status is `"connected"`
- **THEN** the response includes `appSlug` from the GitHub `/app` response

#### Scenario: Non-connected response omits appSlug
- **WHEN** the connectivity status is not `"connected"`
- **THEN** the response SHALL NOT include `appSlug`
