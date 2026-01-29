#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { SpotRunnerFoundationStack } from "../lib/foundation-stack";
import { SpotRunnerStack } from "../lib/spot-runner-stack";

const app = new cdk.App();

// Get configuration from context or environment
// Note: githubServerUrl and githubAppId are only required for the app stack
const githubServerUrl = app.node.tryGetContext("githubServerUrl")
  ?? process.env.GITHUB_SERVER_URL;

const githubAppId = app.node.tryGetContext("githubAppId")
  ?? process.env.GITHUB_APP_ID;

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// Foundation stack - VPC, security group, and private key secret (long-lived, deploy first)
// After deploying this stack:
// 1. Create a GitHub App on GitHub (without webhook URL)
// 2. Download the private key and upload to the secret ARN from stack outputs
// 3. Deploy the app stack below
// 4. Update your GitHub App with the webhook URL and secret from app stack outputs
const foundation = new SpotRunnerFoundationStack(app, "SpotRunnerFoundationStack", {
  env,
});

// Validate required configuration for app stack
// These are only needed after the GitHub App is registered
const missing: string[] = [];
if (!githubServerUrl) missing.push("githubServerUrl (context) or GITHUB_SERVER_URL (env)");
if (!githubAppId) missing.push("githubAppId (context) or GITHUB_APP_ID (env)");

if (missing.length > 0) {
  // Only fail during app stack synthesis/deploy, not for foundation-only deploys
  console.warn(
    `Note: App stack requires additional configuration:\n  - ${missing.join("\n  - ")}\n\n` +
    `Deploy the foundation stack first, then register your GitHub App, then deploy the app stack.\n` +
    `Example: cdk deploy SpotRunnerStack -c githubServerUrl=https://github.com -c githubAppId=12345`
  );
}

// Application stack - API Gateway, Lambda handlers, DynamoDB, etc. (frequently iterated)
// Only create if we have the required GitHub App configuration
if (githubServerUrl && githubAppId) {
  new SpotRunnerStack(app, "SpotRunnerStack", {
    env,
    vpc: foundation.vpc,
    runnerSecurityGroup: foundation.runnerSecurityGroup,
    privateKeySecret: foundation.privateKeySecret,
    githubServerUrl,
    githubAppId,
    presets: [
      {
        name: "linux-x64",
        architecture: "x86_64",
        instanceTypes: ["m5.large", "m5.xlarge", "m5a.large", "m5a.xlarge"],
        labels: ["linux", "ubuntu"],
      },
    ],
  });
}
