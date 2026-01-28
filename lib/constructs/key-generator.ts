import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cr from "aws-cdk-lib/custom-resources";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export interface KeyGeneratorProps {
  /**
   * Description for the secret.
   * @default "GitHub App private key"
   */
  readonly description?: string;
}

/**
 * Custom resource that generates an RSA key pair for GitHub App authentication.
 *
 * The private key is stored in Secrets Manager and the public key is exposed
 * as a CloudFormation output for registering with GitHub.
 */
export class KeyGenerator extends Construct {
  /**
   * Secret containing the RSA private key (PEM format).
   */
  public readonly privateKeySecret: secretsmanager.ISecret;

  /**
   * The public key in PEM format (for GitHub App registration).
   */
  public readonly publicKey: string;

  constructor(scope: Construct, id: string, props?: KeyGeneratorProps) {
    super(scope, id);

    const description = props?.description ?? "GitHub App private key";

    // Create the secret first (empty, will be populated by custom resource)
    const secret = new secretsmanager.Secret(this, "PrivateKey", {
      description,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.privateKeySecret = secret;

    // Create custom resource handler to generate the key pair
    const onEventHandler = new lambda.SingletonFunction(this, "Handler", {
      uuid: "github-app-key-generator-handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      timeout: cdk.Duration.minutes(2),
      code: lambda.Code.fromInline(`
const { SecretsManagerClient, PutSecretValueCommand, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const crypto = require("crypto");

const client = new SecretsManagerClient({});

exports.handler = async (event) => {
  console.log("Event:", JSON.stringify(event, null, 2));

  const { RequestType, ResourceProperties } = event;
  const { secretArn } = ResourceProperties;

  if (RequestType === "Create") {
    // Generate RSA key pair
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    // Store private key in Secrets Manager
    await client.send(new PutSecretValueCommand({
      SecretId: secretArn,
      SecretString: privateKey,
    }));

    console.log("Generated and stored new key pair");
    return {
      PhysicalResourceId: secretArn,
      Data: { PublicKey: publicKey },
    };
  } else if (RequestType === "Update") {
    // On update, retrieve existing public key (don't regenerate)
    const result = await client.send(new GetSecretValueCommand({
      SecretId: secretArn,
    }));

    const privateKey = result.SecretString;
    // Derive public key from private key
    const keyObject = crypto.createPrivateKey(privateKey);
    const publicKey = crypto.createPublicKey(keyObject).export({
      type: "spki",
      format: "pem",
    });

    return {
      PhysicalResourceId: secretArn,
      Data: { PublicKey: publicKey },
    };
  } else if (RequestType === "Delete") {
    // Secret deletion is handled by CloudFormation via removalPolicy
    return { PhysicalResourceId: secretArn };
  }

  return { PhysicalResourceId: secretArn };
};
      `),
    });

    // Grant handler permission to write to the secret
    secret.grantWrite(onEventHandler);
    secret.grantRead(onEventHandler);

    // Create the custom resource provider
    const provider = new cr.Provider(this, "Provider", {
      onEventHandler,
    });

    const resource = new cdk.CustomResource(this, "Resource", {
      serviceToken: provider.serviceToken,
      properties: {
        secretArn: secret.secretArn,
        // Version to force re-read on stack updates
        version: "1",
      },
    });

    // Get the public key from the custom resource output
    this.publicKey = resource.getAttString("PublicKey");
  }
}
