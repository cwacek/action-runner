import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import * as path from "path";

export interface CleanupHandlerProps {
  /**
   * DynamoDB table for state management.
   */
  readonly stateTable: dynamodb.ITable;

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
   * How often to run cleanup in minutes.
   * @default 5
   */
  readonly cleanupIntervalMinutes?: number;

  /**
   * TTL for state records in days.
   */
  readonly ttlDays: number;
}

/**
 * Scheduled Lambda for cleaning up stale runners and orphaned instances.
 */
export class CleanupHandler extends Construct {
  public readonly lambda: lambda.IFunction;
  public readonly stuckInstancesAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: CleanupHandlerProps) {
    super(scope, id);

    const provisioningTimeout = props.provisioningTimeoutMinutes ?? 10;
    const jobTimeout = props.jobTimeoutMinutes ?? 60;
    const cleanupInterval = props.cleanupIntervalMinutes ?? 5;

    // Create cleanup Lambda
    this.lambda = new lambdaNodejs.NodejsFunction(this, "Function", {
      entry: path.join(__dirname, "../../lambda/cleanup-handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        STATE_TABLE_NAME: props.stateTable.tableName,
        TTL_DAYS: String(props.ttlDays),
        PROVISIONING_TIMEOUT_MINUTES: String(provisioningTimeout),
        JOB_TIMEOUT_MINUTES: String(jobTimeout),
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ["@aws-sdk/*"],
      },
    });

    // Grant DynamoDB permissions
    props.stateTable.grantReadWriteData(this.lambda);

    // Grant EC2 permissions for describing and terminating instances
    this.lambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "ec2:DescribeInstances",
          "ec2:TerminateInstances",
        ],
        resources: ["*"],
      })
    );

    // Create scheduled rule
    const rule = new events.Rule(this, "Schedule", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(cleanupInterval)),
      description: "Trigger spot runner cleanup",
    });

    rule.addTarget(new targets.LambdaFunction(this.lambda));

    // Create CloudWatch alarm for stuck instances
    // This fires if cleanup Lambda detects issues consistently
    this.stuckInstancesAlarm = new cloudwatch.Alarm(this, "StuckInstancesAlarm", {
      metric: new cloudwatch.Metric({
        namespace: "SpotRunner",
        metricName: "StuckInstances",
        dimensionsMap: {
          Service: "Cleanup",
        },
        statistic: "Sum",
        period: cdk.Duration.minutes(15),
      }),
      threshold: 5,
      evaluationPeriods: 2,
      alarmDescription: "Alert when multiple runners are stuck and being cleaned up",
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }
}
