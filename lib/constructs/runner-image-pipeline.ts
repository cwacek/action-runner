import * as cdk from "aws-cdk-lib";
import * as imagebuilder from "aws-cdk-lib/aws-imagebuilder";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

export interface RunnerImagePipelineProps {
  /**
   * VPC for building images.
   */
  readonly vpc: ec2.IVpc;

  /**
   * Subnet for the build instance.
   */
  readonly subnet: ec2.ISubnet;

  /**
   * Preset name for tagging and identification.
   * Used to map Image Builder outputs back to presets.
   */
  readonly presetName: string;

  /**
   * CPU architecture for the image.
   * @default "x86_64"
   */
  readonly architecture?: "x86_64" | "arm64";

  /**
   * GitHub Actions runner version.
   * @default "2.331.0"
   */
  readonly runnerVersion?: string;

  /**
   * SHA256 checksum for x64 runner.
   */
  readonly runnerSha256X64?: string;

  /**
   * SHA256 checksum for arm64 runner.
   */
  readonly runnerSha256Arm64?: string;

  /**
   * Schedule for automatic image builds (cron expression).
   * @default - no scheduled builds
   */
  readonly buildSchedule?: string;

  /**
   * Instance types for building images.
   * @default ["c5.xlarge"]
   */
  readonly buildInstanceTypes?: string[];

  /**
   * Additional Docker images to pre-pull.
   * These are pulled in addition to the default set (node, python, golang, etc.).
   * @default []
   */
  readonly additionalDockerImages?: string[];

  /**
   * ARNs of additional Image Builder components to include.
   * These run after the built-in components (Docker, runner, pre-pulled images).
   * Use this to add custom tooling, packages, or configuration.
   * @default []
   */
  readonly additionalComponentArns?: string[];
}

/**
 * EC2 Image Builder pipeline for creating spot runner AMIs.
 *
 * Creates an AMI with:
 * - Docker and common build tools
 * - GitHub Actions runner (SHA256 verified)
 * - Pre-pulled Docker images for faster job startup
 *
 * Users can customize by:
 * - Adding additional Docker images to pre-pull
 * - Adding custom Image Builder components for additional tooling
 * - Scheduling automatic rebuilds
 */
export class RunnerImagePipeline extends Construct {
  public readonly pipelineArn: string;
  public readonly imageRecipeArn: string;

  constructor(scope: Construct, id: string, props: RunnerImagePipelineProps) {
    super(scope, id);

    const architecture = props.architecture ?? "x86_64";
    const runnerVersion = props.runnerVersion ?? "2.331.0";
    const sha256X64 = props.runnerSha256X64 ?? "5fcc01bd546ba5c3f1291c2803658ebd3cedb3836489eda3be357d41bfcf28a7";
    const sha256Arm64 = props.runnerSha256Arm64 ?? "f5863a211241436186723159a111f352f25d5d22711639761ea24c98caef1a9a";

    // Default build instance types based on architecture
    const defaultBuildInstanceTypes = architecture === "arm64" ? ["c6g.xlarge"] : ["c5.xlarge"];
    const buildInstanceTypes = props.buildInstanceTypes ?? defaultBuildInstanceTypes;
    const additionalDockerImages = props.additionalDockerImages ?? [];
    const additionalComponentArns = props.additionalComponentArns ?? [];

    // Parent image based on architecture
    const parentImage = architecture === "arm64"
      ? `arn:aws:imagebuilder:${cdk.Stack.of(this).region}:aws:image/ubuntu-server-22-lts-arm64/x.x.x`
      : `arn:aws:imagebuilder:${cdk.Stack.of(this).region}:aws:image/ubuntu-server-22-lts-x86/x.x.x`;

    // IAM role for EC2 Image Builder
    const instanceRole = new iam.Role(this, "InstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("EC2InstanceProfileForImageBuilder"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
      ],
    });

    const instanceProfile = new iam.InstanceProfile(this, "InstanceProfile", {
      role: instanceRole,
    });

    // Component: Install Docker
    const dockerComponent = new imagebuilder.CfnComponent(this, "DockerComponent", {
      name: `${cdk.Stack.of(this).stackName}-${props.presetName}-docker`,
      platform: "Linux",
      version: "1.0.0",
      data: `
name: InstallDocker
schemaVersion: 1.0
phases:
  - name: build
    steps:
      - name: InstallDocker
        action: ExecuteBash
        inputs:
          commands:
            - curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
            - echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
            - apt-get update
            - apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
            - usermod -aG docker ubuntu
            - systemctl enable docker
`,
    });

    // Component: Install GitHub Actions runner
    const runnerComponent = new imagebuilder.CfnComponent(this, "RunnerComponent", {
      name: `${cdk.Stack.of(this).stackName}-${props.presetName}-runner`,
      platform: "Linux",
      version: "1.0.0",
      data: `
name: InstallRunner
schemaVersion: 1.0
parameters:
  - RunnerVersion:
      type: string
      default: "${runnerVersion}"
  - Sha256X64:
      type: string
      default: "${sha256X64}"
  - Sha256Arm64:
      type: string
      default: "${sha256Arm64}"
phases:
  - name: build
    steps:
      - name: InstallRunner
        action: ExecuteBash
        inputs:
          commands:
            - mkdir -p /opt/actions-runner
            - cd /opt/actions-runner
            - |
              ARCH=$(uname -m)
              if [ "$ARCH" = "x86_64" ]; then
                RUNNER_ARCH="x64"
                EXPECTED_SHA="{{ Sha256X64 }}"
              else
                RUNNER_ARCH="arm64"
                EXPECTED_SHA="{{ Sha256Arm64 }}"
              fi

              RUNNER_TAR="actions-runner-linux-$RUNNER_ARCH-{{ RunnerVersion }}.tar.gz"
              curl -sL -o runner.tar.gz "https://github.com/actions/runner/releases/download/v{{ RunnerVersion }}/$RUNNER_TAR"

              ACTUAL_SHA=$(sha256sum runner.tar.gz | awk '{print $1}')
              if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
                echo "ERROR: SHA256 verification failed!"
                exit 1
              fi

              tar xzf runner.tar.gz
              rm runner.tar.gz
              chown -R ubuntu:ubuntu /opt/actions-runner
`,
    });

    // Build list of Docker images to pre-pull
    const defaultDockerImages = [
      "node:20-alpine",
      "node:20",
      "python:3.11-slim",
      "python:3.11",
      "golang:1.21",
      "alpine:3.19",
      "ubuntu:22.04",
      "docker:24-dind",
    ];
    const allDockerImages = [...defaultDockerImages, ...additionalDockerImages];
    const dockerPullCommands = allDockerImages.map(img => `            - docker pull ${img}`).join("\n");

    // Component: Pre-pull Docker images
    const dockerImagesComponent = new imagebuilder.CfnComponent(this, "DockerImagesComponent", {
      name: `${cdk.Stack.of(this).stackName}-${props.presetName}-docker-images`,
      platform: "Linux",
      version: "1.0.0",
      data: `
name: PullDockerImages
schemaVersion: 1.0
phases:
  - name: build
    steps:
      - name: PullImages
        action: ExecuteBash
        inputs:
          commands:
${dockerPullCommands}
`,
    });

    // Build component list: built-in + user-provided
    const recipeComponents = [
      { componentArn: `arn:aws:imagebuilder:${cdk.Stack.of(this).region}:aws:component/update-linux/x.x.x` },
      { componentArn: dockerComponent.attrArn },
      { componentArn: runnerComponent.attrArn },
      { componentArn: dockerImagesComponent.attrArn },
      // Add user-provided components at the end
      ...additionalComponentArns.map(arn => ({ componentArn: arn })),
    ];

    // Image recipe
    const recipe = new imagebuilder.CfnImageRecipe(this, "Recipe", {
      name: `${cdk.Stack.of(this).stackName}-${props.presetName}`,
      version: "1.0.0",
      parentImage: parentImage,
      components: recipeComponents,
      blockDeviceMappings: [
        {
          deviceName: "/dev/sda1",
          ebs: {
            volumeSize: 100,
            volumeType: "gp3",
            deleteOnTermination: true,
          },
        },
      ],
    });

    this.imageRecipeArn = recipe.attrArn;

    // Infrastructure configuration
    const infraConfig = new imagebuilder.CfnInfrastructureConfiguration(this, "InfraConfig", {
      name: `${cdk.Stack.of(this).stackName}-${props.presetName}`,
      instanceProfileName: instanceProfile.instanceProfileName,
      instanceTypes: buildInstanceTypes,
      subnetId: props.subnet.subnetId,
      terminateInstanceOnFailure: true,
    });

    // Distribution configuration
    const distConfig = new imagebuilder.CfnDistributionConfiguration(this, "DistConfig", {
      name: `${cdk.Stack.of(this).stackName}-${props.presetName}`,
      distributions: [
        {
          region: cdk.Stack.of(this).region,
          amiDistributionConfiguration: {
            name: `spot-runner-${props.presetName}-{{imagebuilder:buildDate}}`,
            amiTags: {
              Name: `spot-runner-${props.presetName}`,
              Runner_Version: runnerVersion,
              Preset_Name: props.presetName,
              Architecture: architecture,
            },
          },
        },
      ],
    });

    // Image pipeline - weekly schedule by default
    const defaultSchedule = "cron(0 4 ? * SUN *)"; // 4 AM UTC every Sunday
    const pipeline = new imagebuilder.CfnImagePipeline(this, "Pipeline", {
      name: `spot-runner-${props.presetName}`,
      imageRecipeArn: recipe.attrArn,
      infrastructureConfigurationArn: infraConfig.attrArn,
      distributionConfigurationArn: distConfig.attrArn,
      schedule: {
        scheduleExpression: props.buildSchedule ?? defaultSchedule,
        pipelineExecutionStartCondition: "EXPRESSION_MATCH_ONLY",
      },
    });

    this.pipelineArn = pipeline.attrArn;

    // Output the pipeline ARN
    new cdk.CfnOutput(this, "PipelineArn", {
      value: this.pipelineArn,
      description: "EC2 Image Builder pipeline ARN",
    });
  }
}
