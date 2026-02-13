import * as crypto from "crypto";

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  serverUrl: string; // e.g., https://github.example.com
}

/**
 * Get the correct API base URL for a GitHub server.
 * For github.com, the API is at api.github.com (no /api/v3 prefix).
 * For GitHub Enterprise Server, the API is at <hostname>/api/v3.
 */
export function getApiBaseUrl(serverUrl: string): string {
  const normalized = serverUrl.replace(/\/+$/, "");
  try {
    const url = new URL(normalized);
    if (url.hostname === "github.com") {
      return "https://api.github.com";
    }
  } catch {
    // Fall through to default
  }
  return `${normalized}/api/v3`;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

// Token cache: installationId -> cached token
const tokenCache = new Map<number, CachedToken>();

// Refresh tokens 5 minutes before expiry
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Generate a JWT for GitHub App authentication.
 * JWTs are valid for 10 minutes max.
 */
export function generateAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60, // Issued 60 seconds ago to account for clock drift
    exp: now + 600, // Expires in 10 minutes
    iss: appId,
  };

  const header = { alg: "RS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));

  const signature = crypto
    .createSign("RSA-SHA256")
    .update(`${encodedHeader}.${encodedPayload}`)
    .sign(privateKey, "base64url");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Exchange App JWT for an installation access token.
 * Tokens are cached and refreshed 5 minutes before expiry.
 */
export async function getInstallationToken(
  config: GitHubAppConfig,
  installationId: number
): Promise<string> {
  const cached = tokenCache.get(installationId);
  const now = Date.now();

  if (cached && cached.expiresAt - TOKEN_REFRESH_BUFFER_MS > now) {
    return cached.token;
  }

  const jwt = generateAppJwt(config.appId, config.privateKey);
  const apiUrl = `${getApiBaseUrl(config.serverUrl)}/app/installations/${installationId}/access_tokens`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to get installation token: ${response.status} ${body}`
    );
  }

  const data = (await response.json()) as { token: string; expires_at: string };
  const expiresAt = new Date(data.expires_at).getTime();

  tokenCache.set(installationId, { token: data.token, expiresAt });
  return data.token;
}

/**
 * Request a JIT (Just-in-Time) runner registration token.
 * This token is single-use and short-lived.
 */
export async function getJitRunnerToken(
  config: GitHubAppConfig,
  installationId: number,
  repoFullName: string,
  labels: string[]
): Promise<{ runner_jit_config: string }> {
  const token = await getInstallationToken(config, installationId);
  const apiUrl = `${getApiBaseUrl(config.serverUrl)}/repos/${repoFullName}/actions/runners/generate-jitconfig`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `spot-runner-${Date.now()}`,
      runner_group_id: 1, // Default runner group
      labels: labels,
      work_folder: "_work",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to get JIT runner token: ${response.status} ${body}`);
  }

  return (await response.json()) as { runner_jit_config: string };
}

/**
 * Validate a webhook signature from GitHub.
 * Returns true if the signature is valid.
 */
export function validateWebhookSignature(
  payload: string | Buffer,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) {
    return false;
  }

  const payloadBuffer =
    typeof payload === "string" ? Buffer.from(payload) : payload;

  // GitHub sends signature as "sha256=<hex>"
  const expectedSignature =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(payloadBuffer).digest("hex");

  console.log("Signature validation debug:", JSON.stringify({
    receivedPrefix: signature.substring(0, 15),
    expectedPrefix: expectedSignature.substring(0, 15),
    receivedLength: signature.length,
    expectedLength: expectedSignature.length,
    payloadBytes: payloadBuffer.length,
  }));

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

/**
 * Parse the installation ID from a webhook payload.
 */
export function getInstallationIdFromPayload(
  payload: Record<string, unknown>
): number | null {
  const installation = payload.installation as
    | { id: number }
    | undefined;
  return installation?.id ?? null;
}
