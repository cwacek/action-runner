import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { SpotRunnerStack } from "../lib/spot-runner-stack";
import { SpotRunnerFoundationStack } from "../lib/foundation-stack";

/**
 * Creates test props using a real foundation stack.
 */
function createTestStacks(app: cdk.App) {
  const foundation = new SpotRunnerFoundationStack(app, "FoundationStack");

  return {
    foundation,
    appProps: {
      vpc: foundation.vpc,
      runnerSecurityGroup: foundation.runnerSecurityGroup,
      api: foundation.api,
      apiRootResourceId: foundation.apiRootResourceId,
      privateKeySecret: foundation.privateKeySecret,
      webhookSecret: foundation.webhookSecret,
      githubServerUrl: "https://github.example.com",
      githubAppId: "123456",
      presets: [
        {
          name: "linux-x64",
          architecture: "x86_64" as const,
          instanceTypes: ["m5.large", "m5.xlarge"],
          labels: ["linux"],
        },
      ],
    },
  };
}

describe("SpotRunnerStack", () => {
  test("creates DynamoDB table with correct schema", () => {
    const app = new cdk.App();
    const { appProps } = createTestStacks(app);
    const stack = new SpotRunnerStack(app, "TestStack", appProps);
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

  test("does not create its own secrets (uses foundation)", () => {
    const app = new cdk.App();
    const { appProps } = createTestStacks(app);
    const stack = new SpotRunnerStack(app, "TestStack", appProps);
    const template = Template.fromStack(stack);

    // App stack should NOT create any secrets (they come from foundation)
    template.resourceCountIs("AWS::SecretsManager::Secret", 0);
  });

  test("does not create API Gateway (uses foundation)", () => {
    const app = new cdk.App();
    const { appProps } = createTestStacks(app);
    const stack = new SpotRunnerStack(app, "TestStack", appProps);
    const template = Template.fromStack(stack);

    // App stack should NOT create RestApi (it uses foundation's API)
    template.resourceCountIs("AWS::ApiGateway::RestApi", 0);
  });

  test("creates Lambda functions", () => {
    const app = new cdk.App();
    const { appProps } = createTestStacks(app);
    const stack = new SpotRunnerStack(app, "TestStack", appProps);
    const template = Template.fromStack(stack);

    // Should have at least 2 Lambda functions (webhook and cleanup)
    const lambdas = template.findResources("AWS::Lambda::Function");
    expect(Object.keys(lambdas).length).toBeGreaterThanOrEqual(2);
  });

  test("creates SSM parameter for each preset", () => {
    const app = new cdk.App();
    const { appProps } = createTestStacks(app);
    const stack = new SpotRunnerStack(app, "TestStack", appProps);
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/spot-runner/configs/linux-x64",
    });
  });

  test("uses VPC from foundation (does not create its own)", () => {
    const app = new cdk.App();
    const { appProps } = createTestStacks(app);
    const stack = new SpotRunnerStack(app, "TestStack", appProps);
    const template = Template.fromStack(stack);

    // App stack should NOT create any VPC resources
    template.resourceCountIs("AWS::EC2::VPC", 0);
  });

  test("creates launch template", () => {
    const app = new cdk.App();
    const { appProps } = createTestStacks(app);
    const stack = new SpotRunnerStack(app, "TestStack", appProps);
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
