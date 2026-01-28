import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { SpotRunnerStack } from "../lib/spot-runner-stack";

function createBaseProps(foundationStack: cdk.Stack) {
  const vpc = new ec2.Vpc(foundationStack, "TestVpc", { maxAzs: 2, natGateways: 1 });
  const runnerSecurityGroup = new ec2.SecurityGroup(foundationStack, "TestSG", {
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
  };
}

describe("Preset Validation", () => {
  test("throws error when presets array is empty", () => {
    const app = new cdk.App();
    const foundationStack = new cdk.Stack(app, "FoundationStack");
    const baseProps = createBaseProps(foundationStack);
    expect(() => {
      new SpotRunnerStack(app, "TestStack", {
        ...baseProps,
        presets: [],
      });
    }).toThrow("At least one runner preset is required");
  });

  test("throws error for duplicate preset names", () => {
    const app = new cdk.App();
    const foundationStack = new cdk.Stack(app, "FoundationStack");
    const baseProps = createBaseProps(foundationStack);
    expect(() => {
      new SpotRunnerStack(app, "TestStack", {
        ...baseProps,
        presets: [
          { name: "linux-x64", architecture: "x86_64" },
          { name: "linux-x64", architecture: "arm64" },
        ],
      });
    }).toThrow("Duplicate preset name: linux-x64");
  });

  test("throws error for invalid architecture", () => {
    const app = new cdk.App();
    const foundationStack = new cdk.Stack(app, "FoundationStack");
    const baseProps = createBaseProps(foundationStack);
    expect(() => {
      new SpotRunnerStack(app, "TestStack", {
        ...baseProps,
        presets: [
          { name: "linux-x64", architecture: "invalid" as "x86_64" },
        ],
      });
    }).toThrow(/Invalid architecture/);
  });

  test("accepts valid preset configuration", () => {
    const app = new cdk.App();
    const foundationStack = new cdk.Stack(app, "FoundationStack");
    const baseProps = createBaseProps(foundationStack);
    expect(() => {
      new SpotRunnerStack(app, "TestStack", {
        ...baseProps,
        presets: [
          {
            name: "linux-x64",
            architecture: "x86_64",
            instanceTypes: ["m5.large"],
            labels: ["linux"],
          },
        ],
      });
    }).not.toThrow();
  });

  test("accepts multiple presets with different architectures", () => {
    const app = new cdk.App();
    const foundationStack = new cdk.Stack(app, "FoundationStack");
    const baseProps = createBaseProps(foundationStack);
    expect(() => {
      new SpotRunnerStack(app, "TestStack", {
        ...baseProps,
        presets: [
          { name: "linux-x64", architecture: "x86_64" },
          { name: "linux-arm64", architecture: "arm64" },
        ],
      });
    }).not.toThrow();
  });
});
