import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { Template } from "aws-cdk-lib/assertions";
import { StateTable, RunnerLaunchTemplate, WebhookHandler, CleanupHandler } from "../lib/constructs";

describe("Isolate hang", () => {
  test("1. StateTable alone", () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, "Test1");
    new StateTable(stack, "StateTable", { ttlDays: 7 });
    Template.fromStack(stack);
    console.log("StateTable: OK");
  }, 10000);

  test("2. VPC + SecurityGroup", () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, "Test2");
    const vpc = new ec2.Vpc(stack, "Vpc", { maxAzs: 2 });
    new ec2.SecurityGroup(stack, "SG", { vpc });
    Template.fromStack(stack);
    console.log("VPC+SG: OK");
  }, 10000);

  test("3. LaunchTemplate", () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, "Test3");
    const vpc = new ec2.Vpc(stack, "Vpc", { maxAzs: 1, natGateways: 0 });
    const sg = new ec2.SecurityGroup(stack, "SG", { vpc });
    const role = new iam.Role(stack, "Role", { assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com") });
    const profile = new iam.InstanceProfile(stack, "Profile", { role });
    new RunnerLaunchTemplate(stack, "LT", { vpc, securityGroups: [sg], instanceProfile: profile });
    Template.fromStack(stack);
    console.log("LaunchTemplate: OK");
  }, 10000);

  test("4. WebhookHandler", () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, "Test4");
    const vpc = new ec2.Vpc(stack, "Vpc", { maxAzs: 1, natGateways: 0 });
    const sg = new ec2.SecurityGroup(stack, "SG", { vpc });
    const table = new StateTable(stack, "Table", { ttlDays: 7 });
    const secret1 = new secretsmanager.Secret(stack, "S1");
    const secret2 = new secretsmanager.Secret(stack, "S2");
    const role = new iam.Role(stack, "Role", { assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com") });
    const profile = new iam.InstanceProfile(stack, "Profile", { role });
    const lt = new RunnerLaunchTemplate(stack, "LT", { vpc, securityGroups: [sg], instanceProfile: profile });

    // Create API Gateway for webhook
    const api = new apigateway.RestApi(stack, "Api", {
      restApiName: "test-api",
    });
    // Add a placeholder method to make the API valid
    api.root.addResource("health").addMethod("GET");

    new WebhookHandler(stack, "WH", {
      stateTable: table.table,
      privateKeySecret: secret1,
      webhookSecret: secret2,
      githubAppId: "123",
      githubServerUrl: "https://example.com",
      launchTemplateId: lt.launchTemplate.launchTemplateId ?? "",
      subnets: vpc.publicSubnets,
      securityGroups: [sg],
      ttlDays: 7,
      configPrefix: "/test",
      api,
      apiRootResourceId: api.root.resourceId,
    });
    Template.fromStack(stack);
    console.log("WebhookHandler: OK");
  }, 10000);

  test("5. CleanupHandler", () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, "Test5");
    const table = new StateTable(stack, "Table", { ttlDays: 7 });

    new CleanupHandler(stack, "CH", {
      stateTable: table.table,
      ttlDays: 7,
    });
    Template.fromStack(stack);
    console.log("CleanupHandler: OK");
  }, 10000);
});
