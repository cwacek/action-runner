import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const ssmClient = new SSMClient({});
const CONFIG_PREFIX = process.env.CONFIG_PREFIX ?? "/spot-runner/configs";

export interface RunnerConfig {
  instanceTypes: string[];
  ami: string;
  diskSizeGb: number;
  spotStrategy: "spotOnly" | "spotPreferred" | "onDemandOnly";
  timeout: number; // seconds
  labels: string[];
}

export interface ParsedLabel {
  config: string;
  options: Map<string, string>;
}

/**
 * Parse a spotrunner label from runs-on.
 * Format: spotrunner/<config>/<opt1>=<val1>,<opt2>=<val2>
 * Examples:
 *   - spotrunner/linux-x64
 *   - spotrunner/linux-x64/cpu=2,ram=8
 *   - spotrunner/linux-arm64/ram=16
 */
export function parseSpotrunnerLabel(labels: string[]): ParsedLabel | null {
  // GitHub Actions may send comma-separated runs-on values as a single string
  // (e.g., "self-hosted,spotrunner/linux-x64"), so split on commas first.
  const expanded = labels.flatMap((l) => l.split(",").map((s) => s.trim()));

  for (const label of expanded) {
    const normalized = label.toLowerCase().trim();

    if (!normalized.startsWith("spotrunner/")) {
      continue;
    }

    const parts = normalized.slice("spotrunner/".length).split("/");
    if (parts.length === 0 || !parts[0]) {
      continue;
    }

    const config = parts[0];
    const options = new Map<string, string>();

    // Parse options from remaining parts (e.g., "cpu=2,ram=8")
    if (parts.length > 1 && parts[1]) {
      const optParts = parts[1].split(",");
      for (const opt of optParts) {
        const [key, value] = opt.split("=");
        if (key && value) {
          options.set(key.trim(), value.trim());
        }
      }
    }

    return { config, options };
  }

  return null;
}

/**
 * Parse resource requirements from options.
 */
export interface ResourceRequirements {
  cpu?: number;
  ram?: number; // GB
}

export function parseResourceRequirements(
  options: Map<string, string>
): ResourceRequirements {
  const reqs: ResourceRequirements = {};

  const cpu = options.get("cpu");
  if (cpu) {
    const parsed = parseInt(cpu, 10);
    if (!isNaN(parsed) && parsed > 0) {
      reqs.cpu = parsed;
    }
  }

  const ram = options.get("ram");
  if (ram) {
    const parsed = parseInt(ram, 10);
    if (!isNaN(parsed) && parsed > 0) {
      reqs.ram = parsed;
    }
  }

  return reqs;
}

/**
 * Normalize labels for configuration lookup.
 * Filters to spotrunner labels and normalizes case.
 */
export function normalizeLabels(labels: string[]): string[] {
  return labels
    .map((l) => l.toLowerCase().trim())
    .filter((l) => l !== "self-hosted")
    .sort();
}

/**
 * Validate a runner configuration object.
 */
export function validateConfig(config: unknown): config is RunnerConfig {
  if (!config || typeof config !== "object") {
    return false;
  }

  const c = config as Record<string, unknown>;

  // Required fields
  if (!Array.isArray(c.instanceTypes) || c.instanceTypes.length === 0) {
    return false;
  }

  if (typeof c.ami !== "string" || !c.ami) {
    return false;
  }

  if (typeof c.diskSizeGb !== "number" || c.diskSizeGb <= 0) {
    return false;
  }

  if (
    c.spotStrategy !== "spotOnly" &&
    c.spotStrategy !== "spotPreferred" &&
    c.spotStrategy !== "onDemandOnly"
  ) {
    return false;
  }

  if (typeof c.timeout !== "number" || c.timeout <= 0) {
    return false;
  }

  if (!Array.isArray(c.labels)) {
    return false;
  }

  return true;
}

/**
 * Get runner configuration from SSM Parameter Store.
 * Looks up: {CONFIG_PREFIX}/{configName}
 */
export async function getRunnerConfig(
  configName: string
): Promise<RunnerConfig | null> {
  const parameterName = `${CONFIG_PREFIX}/${configName}`;

  try {
    const response = await ssmClient.send(
      new GetParameterCommand({
        Name: parameterName,
        WithDecryption: true,
      })
    );

    if (!response.Parameter?.Value) {
      return null;
    }

    const parsed = JSON.parse(response.Parameter.Value) as unknown;

    if (!validateConfig(parsed)) {
      console.error(`Invalid configuration at ${parameterName}`);
      return null;
    }

    return parsed;
  } catch (error) {
    if ((error as { name?: string }).name === "ParameterNotFound") {
      return null;
    }
    throw error;
  }
}

/**
 * Get default runner configuration.
 */
export async function getDefaultConfig(): Promise<RunnerConfig | null> {
  return getRunnerConfig("default");
}

/**
 * Resolve the runner configuration for a set of labels.
 * Returns the config and the parsed label info.
 */
export async function resolveRunnerConfig(labels: string[]): Promise<{
  config: RunnerConfig;
  parsedLabel: ParsedLabel;
  resources: ResourceRequirements;
} | null> {
  const parsedLabel = parseSpotrunnerLabel(labels);

  if (!parsedLabel) {
    console.log("No spotrunner label found in:", labels);
    return null;
  }

  // Try specific config first
  let config = await getRunnerConfig(parsedLabel.config);

  // Fall back to default if not found
  if (!config) {
    console.log(`Config not found for ${parsedLabel.config}, trying default`);
    config = await getDefaultConfig();
  }

  if (!config) {
    console.error(`No configuration found for labels:`, labels);
    return null;
  }

  const resources = parseResourceRequirements(parsedLabel.options);

  return { config, parsedLabel, resources };
}
