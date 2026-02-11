import { SSMClient, GetParameterCommand, PutParameterCommand } from "@aws-sdk/client-ssm";

const ssmClient = new SSMClient({});
const CONFIG_PREFIX = process.env.CONFIG_PREFIX ?? "/spot-runner/configs";

/**
 * Update SSM parameter with new AMI ID for a preset.
 * Reads the current config, updates the ami field, and writes back.
 */
export async function updateSsmConfig(presetName: string, amiId: string): Promise<void> {
  const parameterName = `${CONFIG_PREFIX}/${presetName}`;

  // Get current config
  const getResult = await ssmClient.send(
    new GetParameterCommand({ Name: parameterName })
  );

  if (!getResult.Parameter?.Value) {
    console.error(`SSM parameter not found: ${parameterName}`);
    return;
  }

  // Parse, update AMI, and write back
  const config = JSON.parse(getResult.Parameter.Value);
  config.ami = amiId;

  await ssmClient.send(
    new PutParameterCommand({
      Name: parameterName,
      Value: JSON.stringify(config),
      Type: "String",
      Overwrite: true,
    })
  );

  console.log(`Updated SSM parameter ${parameterName} with AMI ${amiId}`);
}
