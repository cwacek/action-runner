#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { SpotRunnerStack } from "../lib/spot-runner-stack";

const app = new cdk.App();

// Get configuration from context or environment
const githubServerUrl = app.node.tryGetContext("githubServerUrl")
  ?? process.env.GITHUB_SERVER_URL
  ?? "https://github.example.com";

const githubAppId = app.node.tryGetContext("githubAppId")
  ?? process.env.GITHUB_APP_ID
  ?? "123456";

const githubAppPrivateKey = app.node.tryGetContext("githubAppPrivateKey")
  ?? process.env.GITHUB_APP_PRIVATE_KEY
  ?? "-----BEGIN RSA PRIVATE KEY-----\nPLACEHOLDER\n-----END RSA PRIVATE KEY-----";

const webhookSecret = app.node.tryGetContext("webhookSecret")
  ?? process.env.WEBHOOK_SECRET
  ?? "placeholder-secret";

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
