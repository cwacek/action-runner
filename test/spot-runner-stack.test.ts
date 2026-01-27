import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { SpotRunnerStack } from "../lib/spot-runner-stack";

const TEST_PROPS = {
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

describe("SpotRunnerStack", () => {
  test("creates DynamoDB table with correct schema", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerStack(app, "TestStack", TEST_PROPS);
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
    const stack = new SpotRunnerStack(app, "TestStack", TEST_PROPS);
    const template = Template.fromStack(stack);

    // Should have two secrets (private key and webhook secret)
    template.resourceCountIs("AWS::SecretsManager::Secret", 2);
  });

  test("creates API Gateway", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerStack(app, "TestStack", TEST_PROPS);
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::ApiGateway::RestApi", {
      Name: "spot-runner-webhook",
    });
  });

  test("creates Lambda functions", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerStack(app, "TestStack", TEST_PROPS);
    const template = Template.fromStack(stack);

    // Should have at least 2 Lambda functions (webhook and cleanup)
    const lambdas = template.findResources("AWS::Lambda::Function");
    expect(Object.keys(lambdas).length).toBeGreaterThanOrEqual(2);
  });

  test("creates SSM parameter for each preset", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerStack(app, "TestStack", TEST_PROPS);
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/spot-runner/configs/linux-x64",
    });
  });

  test("creates VPC when not provided", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerStack(app, "TestStack", TEST_PROPS);
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::EC2::VPC", 1);
  });

  test("creates launch template", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerStack(app, "TestStack", TEST_PROPS);
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
