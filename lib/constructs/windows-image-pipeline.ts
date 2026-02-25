import * as cdk from "aws-cdk-lib";
import * as imagebuilder from "aws-cdk-lib/aws-imagebuilder";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

export interface WindowsImagePipelineProps {
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
   * GitHub Actions runner version.
   * @default "2.331.0"
   */
  readonly runnerVersion?: string;

  /**
   * SHA256 checksum of the Windows x64 runner zip.
   * Update this whenever runnerVersion changes.
   * See: https://github.com/actions/runner/releases
   *
   * IMPORTANT: The default is a placeholder — the image build will fail until
   * you provide the correct SHA for your pinned runnerVersion.
   */
  readonly runnerSha256Win64?: string;

  /**
   * Git ref (tag or commit) of actions/runner-images to clone.
   * Pinning this prevents unexpected build breakage from upstream changes.
   * @default "win22/20250210.1"
   */
  readonly runnerImagesRef?: string;

  /**
   * Schedule for automatic image builds (cron expression).
   * @default "cron(0 4 ? * SUN *)" - 4 AM UTC every Sunday
   */
  readonly buildSchedule?: string;

  /**
   * Instance types for building images.
   * Windows builds require more resources than Linux.
   * @default ["c5.2xlarge"]
   */
  readonly buildInstanceTypes?: string[];

  /**
   * ARNs of additional Image Builder components to include.
   * These run after the built-in components (clone, tools, runner, cleanup).
   * @default []
   */
  readonly additionalComponentArns?: string[];
}

/**
 * EC2 Image Builder pipeline for creating Windows Server 2022 Core spot runner AMIs.
 *
 * Creates an AMI with:
 * - Windows Server 2022 Core (headless, no GUI)
 * - Core dev tools installed via actions/runner-images scripts (Git, Node.js, .NET SDK, Python, PowerShell Core, GitHub CLI)
 * - GitHub Actions runner pre-extracted (registered at boot via user data)
 *
 * Build runs via SSM Agent / ExecutePowerShell — no WinRM required.
 * The actions/runner-images repo is cloned at a pinned ref so installs are battle-tested.
 */
export class WindowsImagePipeline extends Construct {
  public readonly pipelineArn: string;
  public readonly imageRecipeArn: string;

  constructor(scope: Construct, id: string, props: WindowsImagePipelineProps) {
    super(scope, id);

    const runnerVersion = props.runnerVersion ?? "2.331.0";
    // TODO: Replace with the correct SHA256 for actions-runner-win-x64-{runnerVersion}.zip
    // Find it at https://github.com/actions/runner/releases/tag/v{runnerVersion}
    const runnerSha256Win64 = props.runnerSha256Win64 ??
      "473e74b86cd826e073f1c1f2c004d3fb9e6c9665d0d51710a23e5084a601c78a"
    const runnerImagesRef = props.runnerImagesRef ?? "win22/20250210.1";
    const buildInstanceTypes = props.buildInstanceTypes ?? ["c5.2xlarge"];
    const additionalComponentArns = props.additionalComponentArns ?? [];

    // Windows Server 2022 Core — x86_64 only (Windows arm64 on EC2 is not supported)
    const parentImage = `arn:aws:imagebuilder:${cdk.Stack.of(this).region}:aws:image/windows-server-2022-english-core-base/x.x.x`;

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

    // Security group for build instances
    const buildSecurityGroup = new ec2.SecurityGroup(this, "BuildSecurityGroup", {
      vpc: props.vpc,
      description: "Security group for Windows Image Builder build instances",
      allowAllOutbound: true, // Needed for Chocolatey, GitHub, npm, nuget, etc.
    });

    // -------------------------------------------------------------------------
    // Component 1: Download actions/runner-images and run base configuration
    //
    // Git is not available on a fresh Windows Server 2022 Core image, so we
    // download the repo as a zip archive via Invoke-WebRequest instead of
    // cloning. GitHub provides zip archives for any ref at:
    //   /archive/refs/tags/<ref>.zip  (for tags)
    //   /archive/refs/heads/<ref>.zip (for branches)
    // -------------------------------------------------------------------------
    const cloneAndConfigureComponent = new imagebuilder.CfnComponent(this, "CloneAndConfigureComponent", {
      name: `${cdk.Stack.of(this).stackName}-${props.presetName}-win-clone-configure`,
      platform: "Windows",
      version: "1.0.0",
      data: String.raw`
name: CloneAndConfigure
schemaVersion: 1.0
phases:
  - name: build
    steps:
      - name: DownloadRunnerImages
        action: ExecutePowerShell
        inputs:
          commands:
            - Write-Host "Downloading actions/runner-images at ref: ${runnerImagesRef}"
            - $zipUrl = "https://github.com/actions/runner-images/archive/refs/tags/${runnerImagesRef}.zip"
            - Invoke-WebRequest -Uri $zipUrl -OutFile "C:\runner-images.zip" -UseBasicParsing
            - Write-Host "Extracting archive..."
            - Expand-Archive -Path "C:\runner-images.zip" -DestinationPath "C:\" -Force
            - Remove-Item "C:\runner-images.zip" -Force
            - $extracted = Get-Item "C:\runner-images-*" | Select-Object -First 1
            - Rename-Item -Path $extracted.FullName -NewName "runner-images"
            - Write-Host "runner-images available at C:\runner-images"
      - name: RunBaseConfig
        action: ExecutePowerShell
        inputs:
          commands:
            - $scriptsPath = "C:\runner-images\images\windows\scripts\build"
            - Write-Host "Running base configuration scripts..."
            - & "$scriptsPath\Configure-BaseImage.ps1"
            - & "$scriptsPath\Configure-PowerShell.ps1"
            - & "$scriptsPath\Configure-WindowsDefender.ps1"
            - & "$scriptsPath\Install-PowerShellModules.ps1"
            - & "$scriptsPath\Install-WindowsFeatures.ps1"
            - & "$scriptsPath\Install-Chocolatey.ps1"
            - Write-Host "Base configuration complete"
      - name: Reboot
        action: Reboot
        onFailure: Abort
        inputs:
          delaySeconds: 60
`,
    });

    // -------------------------------------------------------------------------
    // Component 2: Install core dev tools, then reboot
    // -------------------------------------------------------------------------
    const installCoreToolsComponent = new imagebuilder.CfnComponent(this, "InstallCoreToolsComponent", {
      name: `${cdk.Stack.of(this).stackName}-${props.presetName}-win-core-tools`,
      platform: "Windows",
      version: "1.0.0",
      data: String.raw`
name: InstallCoreTools
schemaVersion: 1.0
phases:
  - name: build
    steps:
      - name: InstallTools
        action: ExecutePowerShell
        inputs:
          commands:
            - $scriptsPath = "C:\runner-images\images\windows\scripts\build"
            - Write-Host "Installing Git..."
            - & "$scriptsPath\Install-Git.ps1"
            - Write-Host "Installing VisualStudio..."
            - & "$scriptsPath\Install-VisualStudio.ps1"
            - Write-Host "Installing Node.js..."
            - & "$scriptsPath\Install-NodeJS.ps1"
            - Write-Host "Installing .NET SDK..."
            - & "$scriptsPath\Install-DotnetSDK.ps1"
            - Write-Host "Installing Python..."
            - & "$scriptsPath\Install-Python.ps1"
            - Write-Host "Installing PowerShell Core..."
            - & "$scriptsPath\Install-PowershellCore.ps1"
            - Write-Host "Installing GitHub CLI..."
            - & "$scriptsPath\Install-GitHub-CLI.ps1"
            - Write-Host "Core tools installation complete"
      - name: Reboot
        action: Reboot
        onFailure: Abort
        inputs:
          delaySeconds: 60
      - name: VerifyInstalls
        action: ExecutePowerShell
        inputs:
          commands:
            - Write-Host "Post-reboot tool verification..."
            - git --version
            - node --version
            - dotnet --version
            - python --version
            - Write-Host "All tools verified"
`,
    });

    // -------------------------------------------------------------------------
    // Component 3: Download and extract GitHub Actions runner (no registration)
    // Registration happens at instance boot via user data / config.cmd
    // -------------------------------------------------------------------------
    const installRunnerComponent = new imagebuilder.CfnComponent(this, "InstallRunnerComponent", {
      name: `${cdk.Stack.of(this).stackName}-${props.presetName}-win-runner`,
      platform: "Windows",
      version: "1.0.0",
      data: String.raw`
name: InstallRunner
schemaVersion: 1.0
phases:
  - name: build
    steps:
      - name: DownloadRunner
        action: ExecutePowerShell
        inputs:
          commands:
            - $runnerVersion = "${runnerVersion}"
            - $expectedSha = "${runnerSha256Win64}"
            - $runnerZip = "actions-runner-win-x64-$runnerVersion.zip"
            - $downloadUrl = "https://github.com/actions/runner/releases/download/v$runnerVersion/$runnerZip"
            - New-Item -ItemType Directory -Force -Path C:\actions-runner | Out-Null
            - Write-Host "Downloading GitHub Actions runner v$runnerVersion..."
            - Invoke-WebRequest -Uri $downloadUrl -OutFile "C:\actions-runner\runner.zip" -UseBasicParsing
            - $actualSha = (Get-FileHash -Path "C:\actions-runner\runner.zip" -Algorithm SHA256).Hash.ToLower()
            - if ($actualSha -ne $expectedSha) { Write-Error "SHA256 mismatch! Expected: $expectedSha  Got: $actualSha"; exit 1 }
            - Write-Host "SHA256 verified"
            - Expand-Archive -Path "C:\actions-runner\runner.zip" -DestinationPath "C:\actions-runner" -Force
            - Remove-Item "C:\actions-runner\runner.zip" -Force
            - Write-Host "Runner extracted to C:\actions-runner"
`,
    });

    // -------------------------------------------------------------------------
    // Component 4: System cleanup and Sysprep preparation
    // -------------------------------------------------------------------------
    const cleanupComponent = new imagebuilder.CfnComponent(this, "CleanupComponent", {
      name: `${cdk.Stack.of(this).stackName}-${props.presetName}-win-cleanup`,
      platform: "Windows",
      version: "1.0.0",
      data: String.raw`
name: Cleanup
schemaVersion: 1.0
phases:
  - name: build
    steps:
      - name: RunCleanup
        action: ExecutePowerShell
        inputs:
          commands:
            - $scriptsPath = "C:\runner-images\images\windows\scripts\build"
            - Write-Host "Running system cleanup..."
            - if (Test-Path "$scriptsPath\Configure-System.ps1") { & "$scriptsPath\Configure-System.ps1" }
            - if (Test-Path "$scriptsPath\Invoke-Cleanup.ps1") { & "$scriptsPath\Invoke-Cleanup.ps1" }
            - Write-Host "Cleanup complete"
`,
    });

    // Build component list: four built-in phases + optional user-provided components
    const recipeComponents = [
      { componentArn: cloneAndConfigureComponent.attrArn },
      { componentArn: installCoreToolsComponent.attrArn },
      { componentArn: installRunnerComponent.attrArn },
      { componentArn: cleanupComponent.attrArn },
      ...additionalComponentArns.map(arn => ({ componentArn: arn })),
    ];

    // Image recipe — Windows Server 2022 Core, 200 GB root volume
    const recipe = new imagebuilder.CfnImageRecipe(this, "Recipe", {
      name: `${cdk.Stack.of(this).stackName}-${props.presetName}-windows`,
      version: "1.0.0",
      parentImage: parentImage,
      components: recipeComponents,
      blockDeviceMappings: [
        {
          deviceName: "/dev/sda1",
          ebs: {
            volumeSize: 200,
            volumeType: "gp3",
            deleteOnTermination: true,
          },
        },
      ],
    });

    this.imageRecipeArn = recipe.attrArn;

    // Infrastructure configuration
    const infraConfig = new imagebuilder.CfnInfrastructureConfiguration(this, "InfraConfig", {
      name: `${cdk.Stack.of(this).stackName}-${props.presetName}-windows`,
      instanceProfileName: instanceProfile.instanceProfileName,
      instanceTypes: buildInstanceTypes,
      subnetId: props.subnet.subnetId,
      securityGroupIds: [buildSecurityGroup.securityGroupId],
      terminateInstanceOnFailure: true,
    });

    // Distribution configuration
    const distConfig = new imagebuilder.CfnDistributionConfiguration(this, "DistConfig", {
      name: `${cdk.Stack.of(this).stackName}-${props.presetName}-windows`,
      distributions: [
        {
          region: cdk.Stack.of(this).region,
          amiDistributionConfiguration: {
            name: `spot-runner-${props.presetName}-{{imagebuilder:buildDate}}`,
            amiTags: {
              Name: `spot-runner-${props.presetName}`,
              Runner_Version: runnerVersion,
              Preset_Name: props.presetName,
              Platform: "windows",
            },
          },
        },
      ],
    });

    // Image pipeline — weekly Sunday builds by default
    const defaultSchedule = "cron(0 4 ? * SUN *)"; // 4 AM UTC every Sunday
    const pipeline = new imagebuilder.CfnImagePipeline(this, "Pipeline", {
      name: `spot-runner-${props.presetName}-windows`,
      imageRecipeArn: recipe.attrArn,
      infrastructureConfigurationArn: infraConfig.attrArn,
      distributionConfigurationArn: distConfig.attrArn,
      schedule: {
        scheduleExpression: props.buildSchedule ?? defaultSchedule,
        pipelineExecutionStartCondition: "EXPRESSION_MATCH_ONLY",
      },
    });

    this.pipelineArn = pipeline.attrArn;

    new cdk.CfnOutput(this, "PipelineArn", {
      value: this.pipelineArn,
      description: "EC2 Image Builder pipeline ARN for Windows runner",
    });
  }
}
