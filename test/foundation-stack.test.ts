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

    // Should have outputs for VPC ID, security group ID, and private key secret ARN
    const outputs = template.findOutputs("*");
    expect(Object.keys(outputs).length).toBeGreaterThanOrEqual(3);
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

  test("creates placeholder private key secret", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerFoundationStack(app, "TestFoundationStack");
    const template = Template.fromStack(stack);

    // Should have exactly 1 secret (private key placeholder)
    template.resourceCountIs("AWS::SecretsManager::Secret", 1);

    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Description: "GitHub App private key - upload after creating the app on GitHub",
    });
  });

  test("exports privateKeySecret property", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerFoundationStack(app, "TestFoundationStack");

    expect(stack.privateKeySecret).toBeDefined();
  });

  test("does not create API Gateway (moved to app stack)", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerFoundationStack(app, "TestFoundationStack");
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::ApiGateway::RestApi", 0);
  });

  test("does not create key generator custom resource", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerFoundationStack(app, "TestFoundationStack");
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::CloudFormation::CustomResource", 0);
  });

  test("outputs private key secret ARN", () => {
    const app = new cdk.App();
    const stack = new SpotRunnerFoundationStack(app, "TestFoundationStack");
    const template = Template.fromStack(stack);

    const outputs = template.findOutputs("*");
    const outputKeys = Object.keys(outputs);
    expect(outputKeys).toContain("PrivateKeySecretArn");
  });
});
