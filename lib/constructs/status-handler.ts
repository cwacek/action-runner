import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import * as path from "path";

export interface StatusHandlerProps {
  /**
   * DynamoDB table for state management.
   */
  readonly stateTable: dynamodb.ITable;

  /**
   * Existing API Gateway to add status route to.
   */
  readonly api: apigateway.RestApi;
}

/**
 * Lambda function for status API endpoint.
 * Adds /status route to existing API Gateway.
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
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ["@aws-sdk/*"],
      },
    });

    // Grant DynamoDB read permissions
    props.stateTable.grantReadData(this.lambda);

    // Add /status route to API Gateway
    const statusResource = props.api.root.addResource("status");
    statusResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(this.lambda),
      {
        // No authorization required for status endpoint
        authorizationType: apigateway.AuthorizationType.NONE,
      }
    );
  }
}
