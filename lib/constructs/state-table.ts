import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

export interface StateTableProps {
  /**
   * TTL for records in days. Records are automatically deleted after this time.
   * @default 7
   */
  readonly ttlDays?: number;
}

/**
 * DynamoDB table for tracking runner state and AMI lifecycle.
 *
 * Runner State Schema:
 * - PK: jobId (GitHub job ID)
 * - Attributes: instanceId, status, repoFullName, workflowName, labels, createdAt, updatedAt, ttl
 * - GSI: status-index for querying by status
 *
 * AMI State Schema:
 * - PK: "AMI#<preset-name>" (e.g., "AMI#linux-x64")
 * - recordType: "AMI" (for GSI queries)
 * - Attributes: amiId, status (ready|building|failed), updatedAt, buildId
 * - GSI: recordType-index for querying all AMI records
 */
export class StateTable extends Construct {
  public readonly table: dynamodb.Table;
  public readonly ttlDays: number;

  constructor(scope: Construct, id: string, props: StateTableProps = {}) {
    super(scope, id);

    this.ttlDays = props.ttlDays ?? 7;

    this.table = new dynamodb.Table(this, "Table", {
      partitionKey: {
        name: "jobId",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev; change to RETAIN for prod
      timeToLiveAttribute: "ttl",
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // GSI for querying runners by status (e.g., find all "pending" runners)
    this.table.addGlobalSecondaryIndex({
      indexName: "status-index",
      partitionKey: {
        name: "status",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "createdAt",
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying AMI state records by type
    // AMI records use PK format "AMI#<preset-name>" and recordType="AMI"
    this.table.addGlobalSecondaryIndex({
      indexName: "recordType-index",
      partitionKey: {
        name: "recordType",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "updatedAt",
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Output table name for reference
    new cdk.CfnOutput(this, "TableName", {
      value: this.table.tableName,
      description: "DynamoDB table for runner state",
    });
  }
}
