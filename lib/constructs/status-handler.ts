import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import * as path from "node:path";

export interface StatusHandlerProps {
  /**
   * DynamoDB table for state management.
   */
  readonly stateTable: dynamodb.ITable;

  /**
   * Existing API Gateway to add status route to.
   */
  readonly api: apigateway.RestApi;

  /**
   * Root resource ID of the API Gateway (for adding routes).
   */
  readonly apiRootResourceId: string;
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

    // Add /status route to API Gateway using Cfn-level constructs
    // to avoid circular dependency when API is from another stack
    const statusResource = new apigateway.CfnResource(this, "StatusResource", {
      restApiId: props.api.restApiId,
      parentId: props.apiRootResourceId,
      pathPart: "status",
    });

    // Grant API Gateway permission to invoke the Lambda
    this.lambda.addPermission("ApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      sourceArn: `arn:aws:execute-api:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:${props.api.restApiId}/*/*/*`,
    });

    new apigateway.CfnMethod(this, "StatusMethod", {
      restApiId: props.api.restApiId,
      resourceId: statusResource.ref,
      httpMethod: "GET",
      authorizationType: "NONE",
      integration: {
        type: "AWS_PROXY",
        integrationHttpMethod: "POST",
        uri: `arn:aws:apigateway:${cdk.Stack.of(this).region}:lambda:path/2015-03-31/functions/${this.lambda.functionArn}/invocations`,
      },
    });
  }
}
