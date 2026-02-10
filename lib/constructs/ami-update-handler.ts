import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import * as path from "path";

export interface AmiUpdateHandlerProps {
  /**
   * DynamoDB table for state management.
   */
  readonly stateTable: dynamodb.ITable;

  /**
   * EventBridge rule for Image Builder state changes.
   */
  readonly imageBuilderEventRule: events.Rule;

  /**
   * SSM parameter prefix for runner configs.
   */
  readonly configPrefix: string;
}

/**
 * Lambda for handling Image Builder completion events and updating AMI state.
 */
export class AmiUpdateHandler extends Construct {
  public readonly lambda: lambda.IFunction;

  constructor(scope: Construct, id: string, props: AmiUpdateHandlerProps) {
    super(scope, id);

    // Create AMI update Lambda
    this.lambda = new lambdaNodejs.NodejsFunction(this, "Function", {
      entry: path.join(__dirname, "../../lambda/ami-update-handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.minutes(1),
      memorySize: 256,
      environment: {
        STATE_TABLE_NAME: props.stateTable.tableName,
        CONFIG_PREFIX: props.configPrefix,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ["@aws-sdk/*"],
      },
    });

    // Grant DynamoDB permissions
    props.stateTable.grantReadWriteData(this.lambda);

    // Grant SSM permissions to read and write config parameters
    const stack = cdk.Stack.of(this);
    this.lambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter", "ssm:PutParameter"],
        resources: [
          `arn:aws:ssm:${stack.region}:${stack.account}:parameter${props.configPrefix}/*`,
        ],
      })
    );

    // Grant Image Builder read permission to look up AMI from build output
    this.lambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["imagebuilder:GetImage"],
        resources: [
          `arn:aws:imagebuilder:${stack.region}:${stack.account}:image/*`,
        ],
      })
    );

    // Add Lambda as target for Image Builder events
    props.imageBuilderEventRule.addTarget(new targets.LambdaFunction(this.lambda));
  }
}
