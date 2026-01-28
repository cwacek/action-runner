## 1. CDK Infrastructure Updates

- [x] 1.1 Add `presets` configuration to stack props interface (replace `defaultRunnerConfig` with typed preset array)
- [x] 1.2 Add preset validation (duplicate names, invalid architecture, empty array)
- [x] 1.3 Create DynamoDB schema additions for AMI state tracking (PK: `AMI#<preset-name>`, SK: `LATEST`)
- [x] 1.4 Add EventBridge rule for Image Builder state changes (pattern matches AVAILABLE and FAILED states)
- [x] 1.5 Create IAM role for AMI update Lambda (DynamoDB write, SSM write, logs)
- [x] 1.6 Create IAM role for status Lambda (DynamoDB read, logs)

## 2. AMI Update Lambda

- [x] 2.1 Create Lambda handler for Image Builder events (`lambda/ami-update-handler.ts`)
- [x] 2.2 Implement AMI ID extraction from Image Builder event payload
- [x] 2.3 Implement DynamoDB conditional update (only update if timestamp is newer)
- [x] 2.4 Implement SSM parameter update with merged preset config
- [x] 2.5 Handle failed build events (update DynamoDB status to "failed", preserve SSM)
- [x] 2.6 Add Lambda to CDK stack with EventBridge trigger

## 3. Status API Lambda

- [x] 3.1 Create Lambda handler for status endpoint (`lambda/status-handler.ts`)
- [x] 3.2 Implement DynamoDB query to fetch all AMI state records
- [x] 3.3 Implement status aggregation logic (ready/building/degraded)
- [x] 3.4 Implement human-readable message generation
- [x] 3.5 Add Lambda to CDK stack with API Gateway route (`/status` GET, unauthenticated)

## 4. Preset Configuration Management

- [x] 4.1 Update `RunnerImagePipeline` construct to accept preset config and couple with runner settings
- [x] 4.2 Store preset configuration in DynamoDB for AMI Lambda access
- [x] 4.3 Create initial AMI state record on deploy (status: "building", amiId: null)
- [x] 4.4 Configure Image Builder pipeline schedule
- [x] 4.5 Add custom resource to trigger immediate pipeline execution on deploy

## 5. SSM Parameter Integration

- [x] 5.1 Generate SSM parameter path from preset name (`/spot-runner/configs/<preset-name>`)
- [x] 5.2 Create SSM parameter on deploy with preset config (placeholder AMI initially)
- [x] 5.3 Ensure webhook handler reads AMI ID from SSM parameter correctly

## 6. Testing

- [x] 6.1 Unit tests for status Lambda status aggregation logic
- [x] 6.2 Unit tests for AMI update Lambda conditional write logic
- [x] 6.3 Unit tests for message generation
- [x] 6.4 Unit tests for preset validation
- [x] 6.5 Integration test for status endpoint response format
- [x] 6.6 Integration test for end-to-end AMI update flow (mock EventBridge)

## 7. Documentation

- [x] 7.1 Update README with new preset configuration format
- [x] 7.2 Document status endpoint usage and response format
- [x] 7.3 Remove manual AMI configuration steps from setup instructions
