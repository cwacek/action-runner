import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { Construct } from "constructs";
import {
  StateTable,
  RunnerLaunchTemplate,
  WebhookHandler,
  CleanupHandler,
  AmiUpdateHandler,
  StatusHandler,
  RunnerImagePipeline,
  PresetInitializer,
} from "./constructs";

/**
 * Runner preset configuration.
 * Each preset defines a complete runner configuration coupled with its Image Builder pipeline.
 */
export interface RunnerPreset {
  /**
   * Unique identifier for the preset.
   * Used in SSM parameter path: /spot-runner/configs/<name>
   */
  readonly name: string;

  /**
   * CPU architecture for the runner.
   */
  readonly architecture: "x86_64" | "arm64";

  /**
   * EC2 instance types to use. If not specified, defaults based on architecture.
   */
  readonly instanceTypes?: string[];

  /**
   * Additional labels for workflow matching.
   */
  readonly labels?: string[];

  /**
   * Docker images to pre-pull during image build.
   */
  readonly additionalDockerImages?: string[];

  /**
   * Job timeout override in minutes.
   */
  readonly timeout?: number;

  /**
   * Root volume size in GB.
   * @default 100
   */
  readonly diskSizeGb?: number;

  /**
   * Spot instance strategy.
   * @default "spotPreferred"
   */
  readonly spotStrategy?: "spotOnly" | "spotPreferred" | "onDemandOnly";
}

export interface SpotRunnerStackProps extends cdk.StackProps {
  /**
   * GitHub Enterprise Server URL (e.g., https://github.example.com).
   * Required.
   */
  readonly githubServerUrl: string;

  /**
   * GitHub App ID.
   * Required.
   */
  readonly githubAppId: string;

  /**
   * VPC for runners. Must be provided from the foundation stack.
   */
  readonly vpc: ec2.IVpc;

  /**
   * Security group for runner instances. Must be provided from the foundation stack.
   */
  readonly runnerSecurityGroup: ec2.ISecurityGroup;

  /**
   * Secret containing the GitHub App private key. From foundation stack.
   */
  readonly privateKeySecret: secretsmanager.ISecret;

  /**
   * TTL for state records in days.
   * @default 7
   */
  readonly stateTtlDays?: number;

  /**
   * Provisioning timeout in minutes.
   * @default 10
   */
  readonly provisioningTimeoutMinutes?: number;

  /**
   * Job timeout in minutes.
   * @default 60
   */
  readonly jobTimeoutMinutes?: number;

  /**
   * Runner presets. Each preset defines a runner configuration and Image Builder pipeline.
   * At least one preset is required.
   */
  readonly presets: RunnerPreset[];
}

/**
 * Validates preset configurations at synthesis time.
 * @throws Error if validation fails
 */
function validatePresets(presets: RunnerPreset[]): void {
  // Check for empty presets array
  if (!presets || presets.length === 0) {
    throw new Error("At least one runner preset is required");
  }

  // Check for duplicate names
  const names = new Set<string>();
  for (const preset of presets) {
    if (names.has(preset.name)) {
      throw new Error(`Duplicate preset name: ${preset.name}`);
    }
    names.add(preset.name);
  }

  // Validate architecture values
  const validArchitectures = ["x86_64", "arm64"];
  for (const preset of presets) {
    if (!validArchitectures.includes(preset.architecture)) {
      throw new Error(
        `Invalid architecture "${preset.architecture}" for preset "${preset.name}". ` +
        `Must be one of: ${validArchitectures.join(", ")}`
      );
    }
  }
}

export class SpotRunnerStack extends cdk.Stack {
  public readonly stateTable: StateTable;
  public readonly vpc: ec2.IVpc;
  public readonly webhookUrl: string;
  public readonly imageBuilderEventRule: events.Rule;

  constructor(scope: Construct, id: string, props: SpotRunnerStackProps) {
    super(scope, id, props);

    // Validate presets at synthesis time
    validatePresets(props.presets);

    const ttlDays = props.stateTtlDays ?? 7;
    const provisioningTimeout = props.provisioningTimeoutMinutes ?? 10;
    const jobTimeout = props.jobTimeoutMinutes ?? 60;
    const configPrefix = "/spot-runner/configs";

    // VPC and security group from foundation stack
    this.vpc = props.vpc;
    const runnerSecurityGroup = props.runnerSecurityGroup;

    // DynamoDB table for runner state
    this.stateTable = new StateTable(this, "StateTable", {
      ttlDays,
    });

    // Private key secret from foundation stack
    const privateKeySecret = props.privateKeySecret;

    // API Gateway for webhook and status endpoints (created in app stack)
    const api = new apigateway.RestApi(this, "Api", {
      restApiName: "spot-runner-webhook",
      description: "GitHub webhook endpoint for spot runners",
      deployOptions: {
        stageName: "prod",
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    });

    // Health check endpoint
    api.root.addResource("health").addMethod("GET", new apigateway.MockIntegration({
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

    // Webhook secret (generated in app stack, output for GitHub App configuration)
    const webhookSecret = new secretsmanager.Secret(this, "WebhookSecret", {
      description: "GitHub webhook secret for spot-runner",
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 32,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // IAM role for runner instances
    const runnerRole = new iam.Role(this, "RunnerRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      description: "IAM role for spot runner instances",
    });

    // Minimal permissions for runner self-termination
    runnerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ec2:TerminateInstances"],
        resources: ["*"],
        conditions: {
          StringEquals: {
            "ec2:ResourceTag/spot-runner:job-id": "*",
          },
        },
      })
    );

    // CloudWatch Logs permissions
    runnerRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy")
    );

    const instanceProfile = new iam.InstanceProfile(this, "RunnerProfile", {
      role: runnerRole,
    });

    // Launch template for runners (use max disk size from presets)
    const maxDiskSize = Math.max(...props.presets.map(p => p.diskSizeGb ?? 100));
    const launchTemplate = new RunnerLaunchTemplate(this, "LaunchTemplate", {
      vpc: this.vpc,
      securityGroups: [runnerSecurityGroup],
      instanceProfile,
      diskSizeGb: maxDiskSize,
    });

    // Get subnets (prefer private, fall back to public)
    const subnets = this.vpc.privateSubnets.length > 0
      ? this.vpc.privateSubnets
      : this.vpc.publicSubnets;

    // Webhook handler Lambda
    new WebhookHandler(this, "WebhookHandler", {
      stateTable: this.stateTable.table,
      privateKeySecret,
      webhookSecret,
      githubAppId: props.githubAppId,
      githubServerUrl: props.githubServerUrl,
      launchTemplateId: launchTemplate.launchTemplate.launchTemplateId ?? "",
      subnets,
      securityGroups: [runnerSecurityGroup],
      ttlDays,
      configPrefix,
      api,
    });

    this.webhookUrl = `${api.url}webhook`;

    // Cleanup handler Lambda
    new CleanupHandler(this, "CleanupHandler", {
      stateTable: this.stateTable.table,
      provisioningTimeoutMinutes: provisioningTimeout,
      jobTimeoutMinutes: jobTimeout,
      ttlDays,
    });

    // Get a subnet for Image Builder (use first private or public)
    const buildSubnet = subnets[0];

    // Create SSM parameters and Image Builder pipelines for each preset
    for (const preset of props.presets) {
      const defaultInstanceTypes = preset.architecture === "arm64"
        ? ["m6g.large", "m6g.xlarge"]
        : ["m5.large", "m5.xlarge"];

      const config = {
        instanceTypes: preset.instanceTypes ?? defaultInstanceTypes,
        ami: "pending", // Will be updated by AMI lifecycle Lambda
        diskSizeGb: preset.diskSizeGb ?? 100,
        spotStrategy: preset.spotStrategy ?? "spotPreferred",
        timeout: (preset.timeout ?? jobTimeout) * 60,
        labels: [
          "self-hosted",
          preset.architecture === "arm64" ? "ARM64" : "X64",
          "Linux",
          ...(preset.labels ?? []),
        ],
      };

      new ssm.StringParameter(this, `Config-${preset.name}`, {
        parameterName: `${configPrefix}/${preset.name}`,
        stringValue: JSON.stringify(config),
        description: `Runner configuration for preset: ${preset.name}`,
      });

      // Create Image Builder pipeline for this preset
      const imagePipeline = new RunnerImagePipeline(this, `ImagePipeline-${preset.name}`, {
        vpc: this.vpc,
        subnet: buildSubnet,
        presetName: preset.name,
        architecture: preset.architecture,
        additionalDockerImages: preset.additionalDockerImages,
      });

      // Initialize preset state and trigger pipeline build
      new PresetInitializer(this, `PresetInit-${preset.name}`, {
        stateTable: this.stateTable.table,
        presetName: preset.name,
        pipelineArn: imagePipeline.pipelineArn,
        triggerPipelineOnDeploy: true,
      });
    }

    // EventBridge rule for Image Builder state changes
    this.imageBuilderEventRule = new events.Rule(this, "ImageBuilderEventRule", {
      description: "Capture Image Builder completion events for AMI lifecycle",
      eventPattern: {
        source: ["aws.imagebuilder"],
        detailType: ["EC2 Image Builder Image State Change"],
        detail: {
          state: {
            status: ["AVAILABLE", "FAILED"],
          },
        },
      },
    });

    // AMI Update Handler - processes Image Builder completion events
    new AmiUpdateHandler(this, "AmiUpdateHandler", {
      stateTable: this.stateTable.table,
      imageBuilderEventRule: this.imageBuilderEventRule,
      configPrefix,
    });

    // Status Handler - provides /status API endpoint
    new StatusHandler(this, "StatusHandler", {
      stateTable: this.stateTable.table,
      api,
      privateKeySecret,
    });

    // Stack outputs
    new cdk.CfnOutput(this, "StateTableName", {
      value: this.stateTable.table.tableName,
      description: "DynamoDB table for runner state",
    });

    new cdk.CfnOutput(this, "WebhookUrl", {
      value: this.webhookUrl,
      description: "Webhook URL - configure in your GitHub App settings",
    });

    new cdk.CfnOutput(this, "WebhookSecretValue", {
      value: webhookSecret.secretValue.unsafeUnwrap(),
      description: "Webhook secret - configure in your GitHub App settings",
    });
  }
}
