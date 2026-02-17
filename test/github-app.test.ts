import * as crypto from "crypto";
import {
  generateAppJwt,
  validateWebhookSignature,
  getInstallationIdFromPayload,
  getJitRunnerToken,
  GitHubAppConfig,
} from "../lambda/lib/github-app";

// Test RSA key pair (DO NOT use in production)
const TEST_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MmFPMmVshCHKbL0q
rHvuJdXPJYx1j5V2xUvuqPSKlLoV1X0oMzh0qlqHjqBGwTDfVhKfZ9y4yZ5S2wKh
qORFX8k3s/0rDrXmlOKEH3sF7K4mdqCVyfgFh3svkUZN0VLydOSLkS8KoT4LOIJ+
fG+JjWCcACEGF9c5aEJ/qk4b5lY6Iur2/bQnMwuH05G5dK0p8vFGBT9y0sC5FJNe
fJqkFvF6V7x3qL3qFvMr4L9bZqTIpOpU3Y8IIOE1+PCQ9K3Cq0lYuN7cVtFNhPOe
MRB9r7xT14RHvn3A6VcWwKySZPfxY9E0l2GUfQIDAQABAoIBAC5RgZ+hBx7xHnFZ
nQmY436CvdrhCvqP6q7Z2KbkVnK4Z+JF4HxlNHwJpUqXZc9Y9+I0l/p6vpHNJ0VD
Gg0oZ1KEbRsOjKblZetQciku6kzWE0eT9ztZkT5S4xWTtX8xmTZXuqN+iL0F+330
f9veRTA+5T4i6VLHg1Tp6X3SKTL+rG6wdDHkNwL2fPIb5dJ8uL8h3Fa7G/9ai/h4
fpZUjau8xzOXlmrNnakPkxO4cDW7Fjwl7qOUAQq5LNMYqNfzMac3fkCk8f3yE5ai
mHr1R1vHPxNkdJjPf5TRdC2G/LiYQ0L8qyL2MJe1XXXhID6q9clljVeNU+cewgPd
lqFRF00CgYEA7V6xbvtFJI0gGTFs3mC3NnF7O8h8NzJ2l+2fx+TQj5DWRj6vis5I
s7jxNzW6hCQu5Y+wYxHi2FxJ0MFGF0PBP5mY0EbaqV1GJPMxhQQPRH2uf7bqfYdU
T6/N8TQ7wYt3JcvvMmp/GnV+qU0QFQXLG2mfsmsn/Dymv1cqhU1cmfsCgYEA4mFg
s5Rlb0Cr+8LhshkLpaqDr5b4sXNH0QemhDPNYayPfi0NTWD4TDlpbJWYfz2iu+F+
E8GI8V3jEBSzjFp7/iWbk0sOfFnFO7bhR9qO4IXxlReYdEElKmSQUfljBmJy8mdX
i7RqdqfxVdJByj6dLPPv7YCOyKokrtdWJKtTwksCgYBbkvnEcYLT8Hc9np0PL8Dq
lRVspeQORPWlE3DpSmj9SpEhLS0RSq7LILQSdNGH1UM7cFO8G5ld/F4rqz2V0MqP
y7CRXQF0fFCw6epbfOq9i6Pgjt5VE8j9QBWWGZN0cUdKPB7+wkBEMHIgMNSfujr8
HWUDxBW0F7x9tFHHqfkH2wKBgQCUxT8jWg2onTBFfswqWf0MxHF73kL2TvM2uLZx
vRZ5jVq8F7D1R7j6VfYDx1IuD7N4e7y5tAZ3WQYB+xvEOhYH7CXj2Y0Q8PNLqC89
HsKaGUc0j4jDe5xKjDZNNrGhJ0sD0gBvcxQveLDVUvcrxk6bLD4wkkfXMGlNmgCj
FQz4bwKBgQCDNgq3TR3MXAyGNN/2VBAnLYxk/IBE3FxRVB6o9cB9A1Nb4wbp59Vq
R4NKAR6AZFXh0hkxOhRGLNdY1xt5rFBaD5ZLU3oR7b7XCF7n8F6tKz2sf1f4rLzE
5zXKLP8DeNsHfJdO8G6k9DPRH0vCQz8hs7lBLs+g5/hElcP9GyX3xg==
-----END RSA PRIVATE KEY-----`;

describe("GitHub App", () => {
  describe("generateAppJwt", () => {
    test("generates a valid JWT structure", () => {
      const jwt = generateAppJwt("123456", TEST_PRIVATE_KEY);

      // JWT should have 3 parts separated by dots
      const parts = jwt.split(".");
      expect(parts).toHaveLength(3);

      // Decode header and payload
      const header = JSON.parse(
        Buffer.from(parts[0], "base64url").toString()
      );
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString()
      );

      expect(header.alg).toBe("RS256");
      expect(header.typ).toBe("JWT");
      expect(payload.iss).toBe("123456");
      expect(typeof payload.iat).toBe("number");
      expect(typeof payload.exp).toBe("number");
      expect(payload.exp - payload.iat).toBeLessThanOrEqual(660); // ~10 min + 60s buffer
    });
  });

  describe("validateWebhookSignature", () => {
    const secret = "test-webhook-secret";

    test("returns true for valid signature", () => {
      const payload = JSON.stringify({ action: "queued" });
      const signature =
        "sha256=" +
        crypto.createHmac("sha256", secret).update(payload).digest("hex");

      expect(validateWebhookSignature(payload, signature, secret)).toBe(true);
    });

    test("returns false for invalid signature", () => {
      const payload = JSON.stringify({ action: "queued" });
      const signature = "sha256=invalid";

      expect(validateWebhookSignature(payload, signature, secret)).toBe(false);
    });

    test("returns false for missing signature", () => {
      const payload = JSON.stringify({ action: "queued" });

      expect(validateWebhookSignature(payload, undefined, secret)).toBe(false);
    });

    test("returns false for tampered payload", () => {
      const originalPayload = JSON.stringify({ action: "queued" });
      const tamperedPayload = JSON.stringify({ action: "completed" });
      const signature =
        "sha256=" +
        crypto
          .createHmac("sha256", secret)
          .update(originalPayload)
          .digest("hex");

      expect(validateWebhookSignature(tamperedPayload, signature, secret)).toBe(
        false
      );
    });
  });

  describe("getInstallationIdFromPayload", () => {
    test("extracts installation ID from payload", () => {
      const payload = {
        action: "queued",
        installation: { id: 12345 },
      };

      expect(getInstallationIdFromPayload(payload)).toBe(12345);
    });

    test("returns null for missing installation", () => {
      const payload = { action: "queued" };

      expect(getInstallationIdFromPayload(payload)).toBeNull();
    });
  });

  describe("getJitRunnerToken", () => {
    const appConfig: GitHubAppConfig = {
      appId: "123456",
      privateKey: TEST_PRIVATE_KEY,
      webhookSecret: "test-secret",
      serverUrl: "https://github.com",
    };

    let fetchSpy: jest.SpyInstance;

    afterEach(() => {
      fetchSpy?.mockRestore();
    });

    test("parses encoded_jit_config from GitHub API response", async () => {
      const jitConfig = "base64-encoded-jit-config-value";

      fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (url) => {
        const urlStr = url.toString();

        // Mock installation token request
        if (urlStr.includes("/app/installations/")) {
          return new Response(JSON.stringify({ token: "test-token", expires_at: new Date(Date.now() + 3600000).toISOString() }), { status: 200 });
        }

        // Mock owner type lookup
        if (urlStr.match(/\/users\/[^/]+$/)) {
          return new Response(JSON.stringify({ type: "User" }), { status: 200 });
        }

        // Mock JIT config endpoint
        if (urlStr.includes("/actions/runners/generate-jitconfig")) {
          return new Response(JSON.stringify({
            runner: { id: 1, name: "spot-runner-123" },
            encoded_jit_config: jitConfig,
          }), { status: 200 });
        }

        return new Response("Not found", { status: 404 });
      });

      const result = await getJitRunnerToken(appConfig, 12345, "testuser/testrepo", ["self-hosted"]);
      expect(result.encoded_jit_config).toBe(jitConfig);
    });

    test("throws on API error response", async () => {
      fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (url) => {
        const urlStr = url.toString();

        if (urlStr.includes("/app/installations/")) {
          return new Response(JSON.stringify({ token: "test-token", expires_at: new Date(Date.now() + 3600000).toISOString() }), { status: 200 });
        }

        if (urlStr.match(/\/users\/[^/]+$/)) {
          return new Response(JSON.stringify({ type: "User" }), { status: 200 });
        }

        if (urlStr.includes("/actions/runners/generate-jitconfig")) {
          return new Response(JSON.stringify({ message: "Resource not accessible by integration" }), { status: 403 });
        }

        return new Response("Not found", { status: 404 });
      });

      await expect(getJitRunnerToken(appConfig, 12345, "testuser/testrepo", ["self-hosted"]))
        .rejects.toThrow("Failed to get JIT runner token: 403");
    });

    test("uses org endpoint for organizations", async () => {
      const requestedUrls: string[] = [];

      fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (url) => {
        const urlStr = url.toString();
        requestedUrls.push(urlStr);

        if (urlStr.includes("/app/installations/")) {
          return new Response(JSON.stringify({ token: "test-token", expires_at: new Date(Date.now() + 3600000).toISOString() }), { status: 200 });
        }

        if (urlStr.match(/\/users\/[^/]+$/)) {
          return new Response(JSON.stringify({ type: "Organization" }), { status: 200 });
        }

        if (urlStr.includes("/actions/runners/generate-jitconfig")) {
          return new Response(JSON.stringify({
            runner: { id: 1, name: "spot-runner-123" },
            encoded_jit_config: "jit-config",
          }), { status: 200 });
        }

        return new Response("Not found", { status: 404 });
      });

      await getJitRunnerToken(appConfig, 12345, "myorg/testrepo", ["self-hosted"]);

      const jitUrl = requestedUrls.find((u) => u.includes("generate-jitconfig"));
      expect(jitUrl).toContain("/orgs/myorg/");
      expect(jitUrl).not.toContain("/repos/");
    });

    test("uses repo endpoint for user accounts", async () => {
      const requestedUrls: string[] = [];

      fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (url) => {
        const urlStr = url.toString();
        requestedUrls.push(urlStr);

        if (urlStr.includes("/app/installations/")) {
          return new Response(JSON.stringify({ token: "test-token", expires_at: new Date(Date.now() + 3600000).toISOString() }), { status: 200 });
        }

        if (urlStr.match(/\/users\/[^/]+$/)) {
          return new Response(JSON.stringify({ type: "User" }), { status: 200 });
        }

        if (urlStr.includes("/actions/runners/generate-jitconfig")) {
          return new Response(JSON.stringify({
            runner: { id: 1, name: "spot-runner-123" },
            encoded_jit_config: "jit-config",
          }), { status: 200 });
        }

        return new Response("Not found", { status: 404 });
      });

      await getJitRunnerToken(appConfig, 12345, "someuser/testrepo", ["self-hosted"]);

      const jitUrl = requestedUrls.find((u) => u.includes("generate-jitconfig"));
      expect(jitUrl).toContain("/repos/someuser/testrepo/");
      expect(jitUrl).not.toContain("/orgs/");
    });
  });
});
