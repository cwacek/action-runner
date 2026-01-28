import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { SpotRunnerFoundationStack } from "../lib/foundation-stack";

describe("SpotRunnerFoundationStack", () => {
  test("creates VPC with correct configuration", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerFoundationStack(app, "TestFoundationStack");
    const template = Template.fromStack(stack);

    // Verify VPC is created
    template.resourceCountIs("AWS::EC2::VPC", 1);
  });

  test("creates NAT gateway", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerFoundationStack(app, "TestFoundationStack");
    const template = Template.fromStack(stack);

    // Default is 1 NAT gateway
    template.resourceCountIs("AWS::EC2::NatGateway", 1);
  });

  test("creates runner security group", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerFoundationStack(app, "TestFoundationStack");
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::EC2::SecurityGroup", {
      GroupDescription: "Security group for spot runners",
    });
  });

  test("exports vpc property", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerFoundationStack(app, "TestFoundationStack");

    expect(stack.vpc).toBeDefined();
    expect(stack.vpc.vpcId).toBeDefined();
  });

  test("exports runnerSecurityGroup property", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerFoundationStack(app, "TestFoundationStack");

    expect(stack.runnerSecurityGroup).toBeDefined();
    expect(stack.runnerSecurityGroup.securityGroupId).toBeDefined();
  });

  test("creates stack outputs", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerFoundationStack(app, "TestFoundationStack");
    const template = Template.fromStack(stack);

    // Should have outputs for VPC ID and security group ID
    const outputs = template.findOutputs("*");
    expect(Object.keys(outputs).length).toBeGreaterThanOrEqual(2);
  });

  test("respects custom maxAzs", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerFoundationStack(app, "TestFoundationStack", {
      maxAzs: 3,
    });

    // VPC should use the specified maxAzs
    expect(stack.vpc).toBeDefined();
  });

  test("respects custom natGateways count", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerFoundationStack(app, "TestFoundationStack", {
      natGateways: 2,
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::EC2::NatGateway", 2);
  });

  test("creates API Gateway", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerFoundationStack(app, "TestFoundationStack");
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::ApiGateway::RestApi", {
      Name: "spot-runner-webhook",
    });
  });

  test("exports api and webhookUrl properties", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerFoundationStack(app, "TestFoundationStack");

    expect(stack.api).toBeDefined();
    expect(stack.webhookUrl).toBeDefined();
    expect(stack.apiRootResourceId).toBeDefined();
  });

  test("creates webhook secret", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerFoundationStack(app, "TestFoundationStack");
    const template = Template.fromStack(stack);

    // Should have at least 2 secrets (private key + webhook secret)
    template.resourceCountIs("AWS::SecretsManager::Secret", 2);
  });

  test("exports privateKeySecret and webhookSecret properties", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerFoundationStack(app, "TestFoundationStack");

    expect(stack.privateKeySecret).toBeDefined();
    expect(stack.webhookSecret).toBeDefined();
    expect(stack.publicKey).toBeDefined();
  });

  test("creates key generator custom resource", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerFoundationStack(app, "TestFoundationStack");
    const template = Template.fromStack(stack);

    // Custom resource for key generation
    template.hasResourceProperties("AWS::CloudFormation::CustomResource", {});
  });

  test("outputs webhook URL and secret ARNs", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerFoundationStack(app, "TestFoundationStack");
    const template = Template.fromStack(stack);

    // Should have outputs for new resources
    const outputs = template.findOutputs("*");
    const outputKeys = Object.keys(outputs);
    expect(outputKeys).toContain("WebhookUrl");
    expect(outputKeys).toContain("WebhookSecretArn");
    expect(outputKeys).toContain("PrivateKeySecretArn");
    expect(outputKeys).toContain("PublicKey");
  });
});
