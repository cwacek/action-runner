import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { Template } from "aws-cdk-lib/assertions";
import * as fs from "fs";

describe("Inline Lambda test", () => {
  // Test 1: Regular Lambda (no bundling)
  test("Regular Lambda.Function works", () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, "Test1");
    new lambda.Function(stack, "Fn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromInline("exports.handler = () => {}"),
    });
    Template.fromStack(stack);
    console.log("Regular Lambda: OK");
  }, 10000);

  // Test 2: NodejsFunction with a tiny inline file
  test("NodejsFunction with tiny file", () => {
    // Create a minimal temp file
    const tmpFile = "/tmp/tiny-handler.ts";
    fs.writeFileSync(tmpFile, 'export const handler = () => ({ statusCode: 200 });');

    const app = new cdk.App();
    const stack = new cdk.Stack(app, "Test2");
    new lambdaNodejs.NodejsFunction(stack, "Fn", {
      entry: tmpFile,
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
    });
    Template.fromStack(stack);
    console.log("NodejsFunction tiny: OK");
  }, 10000);
});
