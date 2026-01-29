import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import * as path from "node:path";

export interface WebhookHandlerProps {
  /**
   * DynamoDB table for state management.
   */
  readonly stateTable: dynamodb.ITable;

  /**
   * Secret containing the GitHub App private key.
   */
  readonly privateKeySecret: secretsmanager.ISecret;

  /**
   * Secret containing the webhook secret.
   */
  readonly webhookSecret: secretsmanager.ISecret;

  /**
   * GitHub App ID.
   */
  readonly githubAppId: string;

  /**
   * GitHub Enterprise Server URL.
   */
  readonly githubServerUrl: string;

  /**
   * Launch template ID for runners.
   */
  readonly launchTemplateId: string;

  /**
   * VPC subnets for runner instances.
   */
  readonly subnets: ec2.ISubnet[];

  /**
   * Security groups for runner instances.
   */
  readonly securityGroups: ec2.ISecurityGroup[];

  /**
   * TTL for state records in days.
   */
  readonly ttlDays: number;

  /**
   * SSM parameter prefix for runner configs.
   */
  readonly configPrefix: string;

  /**
   * API Gateway REST API (same stack).
   */
  readonly api: apigateway.RestApi;
}

/**
 * Lambda function for handling GitHub webhooks.
 * Adds a /webhook route to the provided API Gateway.
 */
export class WebhookHandler extends Construct {
  public readonly lambda: lambda.IFunction;

  constructor(scope: Construct, id: string, props: WebhookHandlerProps) {
    super(scope, id);

    // Create Lambda function
    this.lambda = new lambdaNodejs.NodejsFunction(this, "Function", {
      entry: path.join(__dirname, "../../lambda/webhook-handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        STATE_TABLE_NAME: props.stateTable.tableName,
        TTL_DAYS: String(props.ttlDays),
        GITHUB_APP_ID: props.githubAppId,
        GITHUB_SERVER_URL: props.githubServerUrl,
        PRIVATE_KEY_SECRET_ARN: props.privateKeySecret.secretArn,
        WEBHOOK_SECRET_ARN: props.webhookSecret.secretArn,
        LAUNCH_TEMPLATE_ID: props.launchTemplateId,
        SUBNET_IDS: props.subnets.map((s) => s.subnetId).join(","),
        SECURITY_GROUP_IDS: props.securityGroups.map((s) => s.securityGroupId).join(","),
        CONFIG_PREFIX: props.configPrefix,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ["@aws-sdk/*"],
      },
    });

    // Grant permissions
    props.stateTable.grantReadWriteData(this.lambda);
    props.privateKeySecret.grantRead(this.lambda);
    props.webhookSecret.grantRead(this.lambda);

    // EC2 permissions for provisioning
    this.lambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "ec2:RunInstances",
          "ec2:CreateFleet",
          "ec2:DescribeSubnets",
          "ec2:CreateTags",
        ],
        resources: ["*"],
      })
    );

    // SSM permissions for config lookup
    this.lambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter${props.configPrefix}/*`,
        ],
      })
    );

    // IAM PassRole for launch template
    this.lambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: ["*"],
        conditions: {
          StringEquals: {
            "iam:PassedToService": "ec2.amazonaws.com",
          },
        },
      })
    );

    // Add /webhook POST route to the API Gateway
    const webhookResource = props.api.root.addResource("webhook");
    webhookResource.addMethod("POST", new apigateway.LambdaIntegration(this.lambda));
  }
}
