import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface RunnerLaunchTemplateProps {
  /**
   * VPC to launch runners in.
   */
  readonly vpc: ec2.IVpc;

  /**
   * Security groups for the runner instances.
   */
  readonly securityGroups: ec2.ISecurityGroup[];

  /**
   * AMI ID for the runner. If not specified, uses latest Amazon Linux 2023.
   */
  readonly amiId?: string;

  /**
   * Root volume size in GB.
   * @default 100
   */
  readonly diskSizeGb?: number;

  /**
   * Instance profile for the runner.
   */
  readonly instanceProfile: iam.IInstanceProfile;
}

/**
 * EC2 Launch Template for spot runner instances.
 */
export class RunnerLaunchTemplate extends Construct {
  public readonly launchTemplate: ec2.LaunchTemplate;

  constructor(
    scope: Construct,
    id: string,
    props: RunnerLaunchTemplateProps
  ) {
    super(scope, id);

    const diskSizeGb = props.diskSizeGb ?? 100;

    // Use provided AMI or latest Amazon Linux 2023
    const machineImage = props.amiId
      ? ec2.MachineImage.genericLinux({ [cdk.Stack.of(this).region]: props.amiId })
      : ec2.MachineImage.latestAmazonLinux2023();

    this.launchTemplate = new ec2.LaunchTemplate(this, "Template", {
      launchTemplateName: `spot-runner-${cdk.Names.uniqueId(this)}`,
      machineImage,
      securityGroup: props.securityGroups[0],
      role: props.instanceProfile.role,
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: ec2.BlockDeviceVolume.ebs(diskSizeGb, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],
      // Instance type is specified at provisioning time
      instanceMetadataTags: true,
      httpTokens: ec2.LaunchTemplateHttpTokens.REQUIRED, // IMDSv2
      detailedMonitoring: true,
    });

    // Output launch template ID
    new cdk.CfnOutput(this, "LaunchTemplateId", {
      value: this.launchTemplate.launchTemplateId ?? "",
      description: "Launch template for spot runners",
    });
  }
}
