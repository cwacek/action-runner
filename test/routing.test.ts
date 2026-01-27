import {
  parseSpotrunnerLabel,
  parseResourceRequirements,
  normalizeLabels,
  validateConfig,
} from "../lambda/lib/routing";

describe("Routing", () => {
  describe("parseSpotrunnerLabel", () => {
    test("parses simple config", () => {
      const result = parseSpotrunnerLabel([
        "self-hosted",
        "spotrunner/linux-x64",
      ]);

      expect(result).not.toBeNull();
      expect(result?.config).toBe("linux-x64");
      expect(result?.options.size).toBe(0);
    });

    test("parses config with single option", () => {
      const result = parseSpotrunnerLabel([
        "self-hosted",
        "spotrunner/linux-x64/ram=8",
      ]);

      expect(result).not.toBeNull();
      expect(result?.config).toBe("linux-x64");
      expect(result?.options.get("ram")).toBe("8");
    });

    test("parses config with multiple options", () => {
      const result = parseSpotrunnerLabel([
        "self-hosted",
        "spotrunner/linux-x64/cpu=2,ram=8",
      ]);

      expect(result).not.toBeNull();
      expect(result?.config).toBe("linux-x64");
      expect(result?.options.get("cpu")).toBe("2");
      expect(result?.options.get("ram")).toBe("8");
    });

    test("normalizes case", () => {
      const result = parseSpotrunnerLabel([
        "self-hosted",
        "SpotRunner/Linux-X64/CPU=4",
      ]);

      expect(result).not.toBeNull();
      expect(result?.config).toBe("linux-x64");
      expect(result?.options.get("cpu")).toBe("4");
    });

    test("returns null when no spotrunner label", () => {
      const result = parseSpotrunnerLabel(["self-hosted", "linux", "x64"]);
      expect(result).toBeNull();
    });

    test("handles empty labels", () => {
      const result = parseSpotrunnerLabel([]);
      expect(result).toBeNull();
    });
  });

  describe("parseResourceRequirements", () => {
    test("parses cpu and ram", () => {
      const options = new Map([
        ["cpu", "4"],
        ["ram", "16"],
      ]);
      const result = parseResourceRequirements(options);

      expect(result.cpu).toBe(4);
      expect(result.ram).toBe(16);
    });

    test("handles missing options", () => {
      const options = new Map<string, string>();
      const result = parseResourceRequirements(options);

      expect(result.cpu).toBeUndefined();
      expect(result.ram).toBeUndefined();
    });

    test("ignores invalid values", () => {
      const options = new Map([
        ["cpu", "invalid"],
        ["ram", "-1"],
      ]);
      const result = parseResourceRequirements(options);

      expect(result.cpu).toBeUndefined();
      expect(result.ram).toBeUndefined();
    });
  });

  describe("normalizeLabels", () => {
    test("removes self-hosted and sorts", () => {
      const result = normalizeLabels(["self-hosted", "x64", "linux"]);
      expect(result).toEqual(["linux", "x64"]);
    });

    test("normalizes case", () => {
      const result = normalizeLabels(["Self-Hosted", "LINUX", "X64"]);
      expect(result).toEqual(["linux", "x64"]);
    });

    test("trims whitespace", () => {
      const result = normalizeLabels(["  linux  ", "x64 "]);
      expect(result).toEqual(["linux", "x64"]);
    });
  });

  describe("validateConfig", () => {
    const validConfig = {
      instanceTypes: ["m5.large", "m5.xlarge"],
      ami: "ami-12345678",
      diskSizeGb: 100,
      spotStrategy: "spotPreferred",
      timeout: 3600,
      labels: ["linux", "x64"],
    };

    test("accepts valid config", () => {
      expect(validateConfig(validConfig)).toBe(true);
    });

    test("rejects null", () => {
      expect(validateConfig(null)).toBe(false);
    });

    test("rejects empty instanceTypes", () => {
      expect(validateConfig({ ...validConfig, instanceTypes: [] })).toBe(false);
    });

    test("rejects missing ami", () => {
      expect(validateConfig({ ...validConfig, ami: "" })).toBe(false);
    });

    test("rejects invalid spotStrategy", () => {
      expect(validateConfig({ ...validConfig, spotStrategy: "invalid" })).toBe(
        false
      );
    });

    test("rejects zero timeout", () => {
      expect(validateConfig({ ...validConfig, timeout: 0 })).toBe(false);
    });

    test("rejects missing labels array", () => {
      expect(validateConfig({ ...validConfig, labels: "linux" })).toBe(false);
    });
  });
});
