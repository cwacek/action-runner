import * as cdk from "aws-cdk-lib";
import { SpotRunnerStack } from "../lib/spot-runner-stack";
import { SpotRunnerFoundationStack } from "../lib/foundation-stack";

function createBaseProps(app: cdk.App) {
  const foundation = new SpotRunnerFoundationStack(app, "FoundationStack");
  return {
    vpc: foundation.vpc,
    runnerSecurityGroup: foundation.runnerSecurityGroup,
    api: foundation.api,
    apiRootResourceId: foundation.apiRootResourceId,
    privateKeySecret: foundation.privateKeySecret,
    webhookSecret: foundation.webhookSecret,
    githubServerUrl: "https://github.example.com",
    githubAppId: "123456",
  };
}

describe("Preset Validation", () => {
  test("throws error when presets array is empty", () => {
    const app = new cdk.App();
    const baseProps = createBaseProps(app);
    expect(() => {
      new SpotRunnerStack(app, "TestStack", {
        ...baseProps,
        presets: [],
      });
    }).toThrow("At least one runner preset is required");
  });

  test("throws error for duplicate preset names", () => {
    const app = new cdk.App();
    const baseProps = createBaseProps(app);
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
    const baseProps = createBaseProps(app);
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
    const baseProps = createBaseProps(app);
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
    const baseProps = createBaseProps(app);
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
