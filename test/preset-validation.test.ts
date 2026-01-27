import * as cdk from "aws-cdk-lib";
import { SpotRunnerStack } from "../lib/spot-runner-stack";

const BASE_PROPS = {
  githubServerUrl: "https://github.example.com",
  githubAppId: "123456",
  githubAppPrivateKey: "-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----",
  webhookSecret: "test-secret",
};

describe("Preset Validation", () => {
  test("throws error when presets array is empty", () => {
    const app = new cdk.App();
    expect(() => {
      new SpotRunnerStack(app, "TestStack", {
        ...BASE_PROPS,
        presets: [],
      });
    }).toThrow("At least one runner preset is required");
  });

  test("throws error for duplicate preset names", () => {
    const app = new cdk.App();
    expect(() => {
      new SpotRunnerStack(app, "TestStack", {
        ...BASE_PROPS,
        presets: [
          { name: "linux-x64", architecture: "x86_64" },
          { name: "linux-x64", architecture: "arm64" },
        ],
      });
    }).toThrow("Duplicate preset name: linux-x64");
  });

  test("throws error for invalid architecture", () => {
    const app = new cdk.App();
    expect(() => {
      new SpotRunnerStack(app, "TestStack", {
        ...BASE_PROPS,
        presets: [
          { name: "linux-x64", architecture: "invalid" as "x86_64" },
        ],
      });
    }).toThrow(/Invalid architecture/);
  });

  test("accepts valid preset configuration", () => {
    const app = new cdk.App();
    expect(() => {
      new SpotRunnerStack(app, "TestStack", {
        ...BASE_PROPS,
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
    expect(() => {
      new SpotRunnerStack(app, "TestStack", {
        ...BASE_PROPS,
        presets: [
          { name: "linux-x64", architecture: "x86_64" },
          { name: "linux-arm64", architecture: "arm64" },
        ],
      });
    }).not.toThrow();
  });
});
