import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

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

    // Stack outputs
    new cdk.CfnOutput(this, "VpcId", {
      value: this.vpc.vpcId,
      description: "VPC ID for runners",
    });

    new cdk.CfnOutput(this, "RunnerSecurityGroupId", {
      value: this.runnerSecurityGroup.securityGroupId,
      description: "Security group ID for runners",
    });
  }
}
