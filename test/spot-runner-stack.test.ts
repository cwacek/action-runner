import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Template } from "aws-cdk-lib/assertions";
import { SpotRunnerStack } from "../lib/spot-runner-stack";

/**
 * Creates test props with a mock VPC and security group.
 * Each test gets its own VPC to avoid cross-test interference.
 */
function createTestProps(stack: cdk.Stack) {
  const vpc = new ec2.Vpc(stack, "TestVpc", {
    maxAzs: 2,
    natGateways: 1,
  });
  const runnerSecurityGroup = new ec2.SecurityGroup(stack, "TestRunnerSG", {
    vpc,
    description: "Test security group",
  });

  return {
    vpc,
    runnerSecurityGroup,
    githubServerUrl: "https://github.example.com",
    githubAppId: "123456",
    githubAppPrivateKey: "-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----",
    webhookSecret: "test-secret",
    presets: [
      {
        name: "linux-x64",
        architecture: "x86_64" as const,
        instanceTypes: ["m5.large", "m5.xlarge"],
        labels: ["linux"],
      },
    ],
  };
}

describe("SpotRunnerStack", () => {
  test("creates DynamoDB table with correct schema", () => {
    const app = new cdk.App();
    const foundationStack = new cdk.Stack(app, "FoundationStack");
    const props = createTestProps(foundationStack);
    const stack = new SpotRunnerStack(app, "TestStack", props);
    const template = Template.fromStack(stack);

    // Verify DynamoDB table exists with correct key schema
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [
        {
          AttributeName: "jobId",
          KeyType: "HASH",
        },
      ],
      BillingMode: "PAY_PER_REQUEST",
      TimeToLiveSpecification: {
        AttributeName: "ttl",
        Enabled: true,
      },
    });
  });

  test("creates Secrets Manager secrets", () => {
    const app = new cdk.App();
    const foundationStack = new cdk.Stack(app, "FoundationStack");
    const props = createTestProps(foundationStack);
    const stack = new SpotRunnerStack(app, "TestStack", props);
    const template = Template.fromStack(stack);

    // Should have two secrets (private key and webhook secret)
    template.resourceCountIs("AWS::SecretsManager::Secret", 2);
  });

  test("creates API Gateway", () => {
    const app = new cdk.App();
    const foundationStack = new cdk.Stack(app, "FoundationStack");
    const props = createTestProps(foundationStack);
    const stack = new SpotRunnerStack(app, "TestStack", props);
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::ApiGateway::RestApi", {
      Name: "spot-runner-webhook",
    });
  });

  test("creates Lambda functions", () => {
    const app = new cdk.App();
    const foundationStack = new cdk.Stack(app, "FoundationStack");
    const props = createTestProps(foundationStack);
    const stack = new SpotRunnerStack(app, "TestStack", props);
    const template = Template.fromStack(stack);

    // Should have at least 2 Lambda functions (webhook and cleanup)
    const lambdas = template.findResources("AWS::Lambda::Function");
    expect(Object.keys(lambdas).length).toBeGreaterThanOrEqual(2);
  });

  test("creates SSM parameter for each preset", () => {
    const app = new cdk.App();
    const foundationStack = new cdk.Stack(app, "FoundationStack");
    const props = createTestProps(foundationStack);
    const stack = new SpotRunnerStack(app, "TestStack", props);
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/spot-runner/configs/linux-x64",
    });
  });

  test("uses VPC from props (does not create its own)", () => {
    const app = new cdk.App();
    const foundationStack = new cdk.Stack(app, "FoundationStack");
    const props = createTestProps(foundationStack);
    const stack = new SpotRunnerStack(app, "TestStack", props);
    const template = Template.fromStack(stack);

    // App stack should NOT create any VPC resources
    template.resourceCountIs("AWS::EC2::VPC", 0);
  });

  test("creates launch template", () => {
    const app = new cdk.App();
    const foundationStack = new cdk.Stack(app, "FoundationStack");
    const props = createTestProps(foundationStack);
    const stack = new SpotRunnerStack(app, "TestStack", props);
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::EC2::LaunchTemplate", {
      LaunchTemplateData: {
        MetadataOptions: {
          HttpTokens: "required", // IMDSv2
        },
      },
    });
  });
});
