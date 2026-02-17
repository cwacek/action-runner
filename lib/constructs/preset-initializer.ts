import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cr from "aws-cdk-lib/custom-resources";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

export interface PresetInitializerProps {
  /**
   * DynamoDB table for state management.
   */
  readonly stateTable: dynamodb.ITable;

  /**
   * Preset name to initialize.
   */
  readonly presetName: string;

  /**
   * Image Builder pipeline ARN to trigger.
   */
  readonly pipelineArn: string;

  /**
   * Whether to trigger the pipeline on deploy.
   * @default true
   */
  readonly triggerPipelineOnDeploy?: boolean;
}

/**
 * Custom resource that initializes preset state in DynamoDB and optionally triggers Image Builder.
 */
export class PresetInitializer extends Construct {
  constructor(scope: Construct, id: string, props: PresetInitializerProps) {
    super(scope, id);

    const triggerPipeline = props.triggerPipelineOnDeploy ?? true;

    // Create custom resource provider
    const onEventHandler = new lambda.SingletonFunction(this, "Handler", {
      uuid: "preset-initializer-handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: "index.handler",
      timeout: cdk.Duration.minutes(2),
      code: lambda.Code.fromInline(`
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");
const { ImagebuilderClient, StartImagePipelineExecutionCommand } = require("@aws-sdk/client-imagebuilder");

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const imagebuilderClient = new ImagebuilderClient({});

exports.handler = async (event) => {
  console.log("Event:", JSON.stringify(event, null, 2));

  const { RequestType, ResourceProperties } = event;
  const { tableName, presetName, pipelineArn, triggerPipeline } = ResourceProperties;

  const jobId = "AMI#" + presetName;

  if (RequestType === "Create" || RequestType === "Update") {
    // Initialize AMI state record
    await ddbClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        jobId,
        recordType: "AMI",
        presetName,
        amiId: null,
        status: "building",
        updatedAt: new Date().toISOString(),
      },
      ConditionExpression: "attribute_not_exists(jobId)",
    })).catch((err) => {
      if (err.name !== "ConditionalCheckFailedException") throw err;
      console.log("AMI state already exists, skipping initialization");
    });

    // Trigger Image Builder pipeline if requested
    if (triggerPipeline === "true") {
      try {
        const result = await imagebuilderClient.send(new StartImagePipelineExecutionCommand({
          imagePipelineArn: pipelineArn,
        }));
        console.log("Pipeline execution started:", result.imageBuildVersionArn);
      } catch (err) {
        // Don't fail the deployment if pipeline trigger fails
        console.error("Failed to trigger pipeline:", err);
      }
    }
  } else if (RequestType === "Delete") {
    // Clean up AMI state record on delete
    await ddbClient.send(new DeleteCommand({
      TableName: tableName,
      Key: { jobId },
    })).catch((err) => {
      console.log("Failed to delete AMI state:", err);
    });
  }

  return { PhysicalResourceId: presetName };
};
      `),
    });

    // Grant permissions
    props.stateTable.grantReadWriteData(onEventHandler);

    onEventHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["imagebuilder:StartImagePipelineExecution"],
        resources: [props.pipelineArn],
      })
    );

    // Create the custom resource
    const provider = new cr.Provider(this, "Provider", {
      onEventHandler,
    });

    new cdk.CustomResource(this, "Resource", {
      serviceToken: provider.serviceToken,
      properties: {
        tableName: props.stateTable.tableName,
        presetName: props.presetName,
        pipelineArn: props.pipelineArn,
        triggerPipeline: triggerPipeline.toString(),
        // Force update when preset name changes
        version: "1",
      },
    });
  }
}
