import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import * as path from "node:path";

export interface StatusHandlerProps {
  /**
   * DynamoDB table for state management.
   */
  readonly stateTable: dynamodb.ITable;

  /**
   * API Gateway REST API (same stack).
   */
  readonly api: apigateway.RestApi;

  /**
   * Secret containing the GitHub App private key (for configuration status check).
   */
  readonly privateKeySecret: secretsmanager.ISecret;
}

/**
 * Lambda function for status API endpoint.
 * Adds /status route to API Gateway.
 */
export class StatusHandler extends Construct {
  public readonly lambda: lambda.IFunction;

  constructor(scope: Construct, id: string, props: StatusHandlerProps) {
    super(scope, id);

    // Create status Lambda
    this.lambda = new lambdaNodejs.NodejsFunction(this, "Function", {
      entry: path.join(__dirname, "../../lambda/status-handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        STATE_TABLE_NAME: props.stateTable.tableName,
        PRIVATE_KEY_SECRET_ARN: props.privateKeySecret.secretArn,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ["@aws-sdk/*"],
      },
    });

    // Grant DynamoDB read permissions
    props.stateTable.grantReadData(this.lambda);

    // Grant read access to private key secret (for configuration check)
    props.privateKeySecret.grantRead(this.lambda);

    // Add /status GET route to the API Gateway
    const statusResource = props.api.root.addResource("status");
    statusResource.addMethod("GET", new apigateway.LambdaIntegration(this.lambda));
  }
}
