#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { SpotRunnerStack } from "../lib/spot-runner-stack";

const app = new cdk.App();

// Get configuration from context or environment
const githubServerUrl = app.node.tryGetContext("githubServerUrl")
  ?? process.env.GITHUB_SERVER_URL;

const githubAppId = app.node.tryGetContext("githubAppId")
  ?? process.env.GITHUB_APP_ID;

const githubAppPrivateKey = app.node.tryGetContext("githubAppPrivateKey")
  ?? process.env.GITHUB_APP_PRIVATE_KEY;

const webhookSecret = app.node.tryGetContext("webhookSecret")
  ?? process.env.WEBHOOK_SECRET;

// Validate required configuration
const missing: string[] = [];
if (!githubServerUrl) missing.push("githubServerUrl (context) or GITHUB_SERVER_URL (env)");
if (!githubAppId) missing.push("githubAppId (context) or GITHUB_APP_ID (env)");
if (!githubAppPrivateKey) missing.push("githubAppPrivateKey (context) or GITHUB_APP_PRIVATE_KEY (env)");
if (!webhookSecret) missing.push("webhookSecret (context) or WEBHOOK_SECRET (env)");

if (missing.length > 0) {
  throw new Error(
    `Missing required configuration:\n  - ${missing.join("\n  - ")}\n\n` +
    `Provide values via CDK context (-c flag) or environment variables.\n` +
    `Example: cdk deploy -c githubServerUrl=https://github.com -c githubAppId=12345 ...`
  );
}

new SpotRunnerStack(app, "SpotRunnerStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  githubServerUrl,
  githubAppId,
  githubAppPrivateKey,
  webhookSecret,
  presets: [
    {
      name: "linux-x64",
      architecture: "x86_64",
      instanceTypes: ["m5.large", "m5.xlarge", "m5a.large", "m5a.xlarge"],
      labels: ["linux", "ubuntu"],
    },
  ],
});
