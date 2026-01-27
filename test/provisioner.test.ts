import { generateUserData } from "../lambda/lib/provisioner";

describe("Provisioner", () => {
  describe("generateUserData", () => {
    test("generates base64 encoded script", () => {
      const userData = generateUserData("test-jit-config", 3600);

      // Should be base64 encoded
      const decoded = Buffer.from(userData, "base64").toString("utf-8");

      // Should contain shebang
      expect(decoded).toContain("#!/bin/bash");

      // Should contain runner setup
      expect(decoded).toContain("actions-runner");

      // Should contain JIT config
      expect(decoded).toContain("jitconfig");

      // Should contain timeout
      expect(decoded).toContain("3600");

      // Should contain self-termination
      expect(decoded).toContain("terminate-instances");
    });
  });
});
