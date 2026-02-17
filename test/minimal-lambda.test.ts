import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { Template } from "aws-cdk-lib/assertions";
import * as path from "path";

describe("Minimal Lambda test", () => {
  test("NodejsFunction with forceDockerBundling=false", () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, "Test");

    new lambdaNodejs.NodejsFunction(stack, "Fn", {
      entry: path.join(__dirname, "../lambda/webhook-handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      bundling: {
        externalModules: ["@aws-sdk/*"],
        forceDockerBundling: false,
      },
    });

    Template.fromStack(stack);
    console.log("NodejsFunction: OK");
  }, 15000);
});
