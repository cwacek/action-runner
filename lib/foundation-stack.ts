import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { KeyGenerator } from "./constructs";

export interface SpotRunnerFoundationStackProps extends cdk.StackProps {
  /**
   * Maximum AZs for the VPC.
   * @default 2
   */
  readonly maxAzs?: number;

  /**
   * Number of NAT gateways.
   * @default 1
   */
  readonly natGateways?: number;
}

/**
 * Foundation stack containing long-lived infrastructure resources.
 *
 * This stack contains resources that are slow to create/destroy and rarely change:
 * - VPC with NAT gateway
 * - Security group for runner instances
 *
 * Separating these from the application stack enables rapid iteration
 * without waiting for VPC/NAT gateway teardown.
 */
export class SpotRunnerFoundationStack extends cdk.Stack {
  /**
   * VPC for runners and other resources.
   */
  public readonly vpc: ec2.IVpc;

  /**
   * Security group for runner instances.
   */
  public readonly runnerSecurityGroup: ec2.ISecurityGroup;

  /**
   * API Gateway REST API for webhooks.
   */
  public readonly api: apigateway.RestApi;

  /**
   * Webhook URL (base URL with /webhook path).
   */
  public readonly webhookUrl: string;

  /**
   * Secret containing the GitHub App private key.
   */
  public readonly privateKeySecret: secretsmanager.ISecret;

  /**
   * Public key in PEM format for GitHub App registration.
   */
  public readonly publicKey: string;

  /**
   * Secret containing the webhook secret.
   */
  public readonly webhookSecret: secretsmanager.ISecret;

  /**
   * Root resource ID of the API Gateway (for adding routes in app stack).
   */
  public readonly apiRootResourceId: string;

  constructor(scope: Construct, id: string, props?: SpotRunnerFoundationStackProps) {
    super(scope, id, props);

    const maxAzs = props?.maxAzs ?? 2;
    const natGateways = props?.natGateways ?? 1;

    // VPC with public and private subnets
    this.vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs,
      natGateways,
      subnetConfiguration: [
        {
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 28,
        },
        {
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    // Security group for runner instances
    this.runnerSecurityGroup = new ec2.SecurityGroup(this, "RunnerSG", {
      vpc: this.vpc,
      description: "Security group for spot runners",
      allowAllOutbound: true,
    });

    // API Gateway for webhook endpoint
    this.api = new apigateway.RestApi(this, "Api", {
      restApiName: "spot-runner-webhook",
      description: "GitHub webhook endpoint for spot runners",
      deployOptions: {
        stageName: "prod",
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    });

    // Store root resource ID for app stack to add routes
    this.apiRootResourceId = this.api.root.resourceId;

    // Add a health check endpoint (required for API Gateway validation)
    // The app stack will add the /webhook route with Lambda integration
    this.api.root.addResource("health").addMethod("GET", new apigateway.MockIntegration({
      integrationResponses: [{
        statusCode: "200",
        responseTemplates: {
          "application/json": JSON.stringify({ status: "ok" }),
        },
      }],
      requestTemplates: {
        "application/json": '{"statusCode": 200}',
      },
    }), {
      methodResponses: [{ statusCode: "200" }],
    });
    this.webhookUrl = `${this.api.url}webhook`;

    // Generate RSA key pair for GitHub App authentication
    const keyGenerator = new KeyGenerator(this, "KeyGenerator", {
      description: "GitHub App private key for spot-runner",
    });
    this.privateKeySecret = keyGenerator.privateKeySecret;
    this.publicKey = keyGenerator.publicKey;

    // Generate webhook secret
    this.webhookSecret = new secretsmanager.Secret(this, "WebhookSecret", {
      description: "GitHub webhook secret for spot-runner",
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 32,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Stack outputs
    new cdk.CfnOutput(this, "VpcId", {
      value: this.vpc.vpcId,
      description: "VPC ID for runners",
    });

    new cdk.CfnOutput(this, "RunnerSecurityGroupId", {
      value: this.runnerSecurityGroup.securityGroupId,
      description: "Security group ID for runners",
    });

    new cdk.CfnOutput(this, "WebhookUrl", {
      value: this.webhookUrl,
      description: "Webhook URL for GitHub App configuration",
    });

    new cdk.CfnOutput(this, "PublicKey", {
      value: this.publicKey,
      description: "Public key (PEM) for GitHub App registration",
    });

    new cdk.CfnOutput(this, "WebhookSecretArn", {
      value: this.webhookSecret.secretArn,
      description: "ARN of the webhook secret",
    });

    new cdk.CfnOutput(this, "PrivateKeySecretArn", {
      value: this.privateKeySecret.secretArn,
      description: "ARN of the private key secret",
    });

    new cdk.CfnOutput(this, "ApiRootResourceId", {
      value: this.apiRootResourceId,
      description: "Root resource ID for adding routes in app stack",
    });
  }
}
