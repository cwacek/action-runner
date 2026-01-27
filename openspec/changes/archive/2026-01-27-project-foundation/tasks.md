## 1. Project Setup

- [ ] 1.1 Initialize CDK project with TypeScript
- [ ] 1.2 Set up project structure (lib/, bin/, lambda/, ami/)
- [ ] 1.3 Configure ESLint, Prettier, and TypeScript strict mode
- [ ] 1.4 Add core dependencies (aws-cdk-lib, constructs, @aws-sdk/*)

## 2. DynamoDB State Management

- [ ] 2.1 Define DynamoDB table schema (job ID as partition key)
- [ ] 2.2 Create CDK construct for runners state table
- [ ] 2.3 Implement state operations: create, update, delete, query by status
- [ ] 2.4 Add TTL for automatic cleanup of old records

## 3. GitHub App Integration

- [ ] 3.1 Implement GitHub App JWT generation from private key
- [ ] 3.2 Implement installation access token exchange with caching
- [ ] 3.3 Implement JIT runner registration token request
- [ ] 3.4 Create webhook signature validation utility
- [ ] 3.5 Add support for multiple GitHub Enterprise Server installations

## 4. Workflow Routing

- [ ] 4.1 Implement `spotrunner/<config>/<opts>` label parser
- [ ] 4.2 Implement label normalization (case, ordering)
- [ ] 4.3 Create SSM parameter lookup for runner configurations
- [ ] 4.4 Implement configuration validation (required fields, types)
- [ ] 4.5 Add resource requirement parsing (cpu=N, ram=N options)

## 5. Spot Provisioning

- [ ] 5.1 Create EC2 launch template construct with spot configuration
- [ ] 5.2 Implement capacity-optimized spot request with multiple instance types
- [ ] 5.3 Implement on-demand fallback logic (after N failures)
- [ ] 5.4 Add multi-AZ provisioning support
- [ ] 5.5 Implement instance tagging (job-id, repo, workflow, labels)
- [ ] 5.6 Create user data script template with JIT token injection

## 6. Runner Lifecycle Lambda

- [ ] 6.1 Create Lambda function scaffold with API Gateway integration
- [ ] 6.2 Implement `workflow_job.queued` webhook handler
- [ ] 6.3 Implement idempotent provisioning (job ID dedup via DynamoDB)
- [ ] 6.4 Wire up GitHub App auth → JIT token → EC2 provisioning flow
- [ ] 6.5 Return appropriate HTTP responses (200, 401, 500)

## 7. Runner Instance Bootstrap

- [ ] 7.1 Create bootstrap script: retrieve JIT token from user data
- [ ] 7.2 Implement runner registration with GitHub Enterprise Server
- [ ] 7.3 Implement job completion detection and self-termination
- [ ] 7.4 Add DynamoDB status update on registration success/failure
- [ ] 7.5 Implement spot interruption handler (metadata polling)

## 8. Cleanup & Timeout Handling

- [ ] 8.1 Create scheduled Lambda for orphan instance detection
- [ ] 8.2 Implement provisioning timeout check (default: 10 min)
- [ ] 8.3 Implement job timeout check (default: 1 hr)
- [ ] 8.4 Add instance termination with DynamoDB cleanup
- [ ] 8.5 Implement CloudWatch alarms for stuck instances

## 9. Infrastructure CDK Construct

- [ ] 9.1 Create main SpotRunner construct with required props
- [ ] 9.2 Implement VPC configuration (user-provided or create default)
- [ ] 9.3 Create Secrets Manager resources for GitHub App credentials
- [ ] 9.4 Create SSM parameters for default runner configurations
- [ ] 9.5 Implement IAM roles with least-privilege policies
- [ ] 9.6 Add stack outputs (webhook URL, secret ARN, table name)

## 10. AMI Pipeline

- [ ] 10.1 Create Packer template based on actions/runner-images
- [ ] 10.2 Pre-install GitHub Actions runner agent
- [ ] 10.3 Pre-pull common Docker images (node, python, etc.)
- [ ] 10.4 Document custom AMI creation process
- [ ] 10.5 Optional: EC2 Image Builder CDK construct

## 11. Testing

- [ ] 11.1 Unit tests for label parsing and normalization
- [ ] 11.2 Unit tests for GitHub App token generation
- [ ] 11.3 Unit tests for webhook signature validation
- [ ] 11.4 Integration tests for DynamoDB state operations
- [ ] 11.5 Integration tests for end-to-end provisioning flow (mocked)

## 12. Documentation

- [ ] 12.1 Write README with quick start guide
- [ ] 12.2 Document GitHub App setup process for GHE Server
- [ ] 12.3 Document runner configuration options (SSM parameters)
- [ ] 12.4 Document custom AMI creation
- [ ] 12.5 Add architecture diagram
