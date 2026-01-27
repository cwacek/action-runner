import {
  AmiStatus,
} from "../lambda/lib/ami-state";

// Mock AWS SDK
jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
  ConditionalCheckFailedException: class ConditionalCheckFailedException extends Error {
    name = "ConditionalCheckFailedException";
  },
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({
      send: jest.fn(),
    }),
  },
  PutCommand: jest.fn().mockImplementation((params) => ({ params })),
  GetCommand: jest.fn().mockImplementation((params) => ({ params })),
  UpdateCommand: jest.fn().mockImplementation((params) => ({ params })),
  QueryCommand: jest.fn().mockImplementation((params) => ({ params })),
}));

describe("AMI State Module", () => {
  describe("getAmiKey", () => {
    // Import after mocking
    let getAmiKey: (presetName: string) => string;

    beforeEach(() => {
      jest.resetModules();
      const amiState = require("../lambda/lib/ami-state");
      getAmiKey = amiState.getAmiKey;
    });

    test("generates correct key format", () => {
      expect(getAmiKey("linux-x64")).toBe("AMI#linux-x64");
      expect(getAmiKey("linux-arm64")).toBe("AMI#linux-arm64");
      expect(getAmiKey("custom-preset")).toBe("AMI#custom-preset");
    });
  });
});

describe("Status Aggregation Logic", () => {
  // Test the aggregation logic patterns
  interface AmiState {
    presetName: string;
    status: AmiStatus;
    amiId: string | null;
  }

  function aggregateStatus(presets: AmiState[]): "ready" | "building" | "degraded" {
    if (presets.length === 0) {
      return "degraded";
    }

    const hasBuilding = presets.some((p) => p.status === "building");
    const hasFailed = presets.some((p) => p.status === "failed");
    const hasNoAmi = presets.some((p) => p.amiId === null && p.status !== "building");
    const allReady = presets.every((p) => p.status === "ready" && p.amiId !== null);

    if (allReady) {
      return "ready";
    }

    if (hasBuilding && !hasFailed && !hasNoAmi) {
      return "building";
    }

    return "degraded";
  }

  test("returns ready when all presets ready with AMIs", () => {
    const presets: AmiState[] = [
      { presetName: "linux-x64", status: "ready", amiId: "ami-123" },
      { presetName: "linux-arm64", status: "ready", amiId: "ami-456" },
    ];
    expect(aggregateStatus(presets)).toBe("ready");
  });

  test("returns building when at least one building and none failed", () => {
    const presets: AmiState[] = [
      { presetName: "linux-x64", status: "ready", amiId: "ami-123" },
      { presetName: "linux-arm64", status: "building", amiId: null },
    ];
    expect(aggregateStatus(presets)).toBe("building");
  });

  test("returns degraded when at least one failed", () => {
    const presets: AmiState[] = [
      { presetName: "linux-x64", status: "ready", amiId: "ami-123" },
      { presetName: "linux-arm64", status: "failed", amiId: null },
    ];
    expect(aggregateStatus(presets)).toBe("degraded");
  });

  test("returns degraded when preset has no AMI and not building", () => {
    const presets: AmiState[] = [
      { presetName: "linux-x64", status: "ready", amiId: null },
    ];
    expect(aggregateStatus(presets)).toBe("degraded");
  });

  test("returns degraded for empty presets", () => {
    expect(aggregateStatus([])).toBe("degraded");
  });

  test("returns degraded when building but has failed preset", () => {
    const presets: AmiState[] = [
      { presetName: "linux-x64", status: "building", amiId: null },
      { presetName: "linux-arm64", status: "failed", amiId: null },
    ];
    expect(aggregateStatus(presets)).toBe("degraded");
  });
});

describe("Message Generation Logic", () => {
  interface AmiState {
    presetName: string;
    status: "ready" | "building" | "failed";
    amiId: string | null;
  }

  function generateMessage(
    presets: AmiState[],
    status: "ready" | "building" | "degraded"
  ): string {
    if (presets.length === 0) {
      return "No presets configured";
    }

    const readyCount = presets.filter((p) => p.status === "ready" && p.amiId !== null).length;
    const buildingCount = presets.filter((p) => p.status === "building").length;
    const failedCount = presets.filter((p) => p.status === "failed").length;
    // Exclude building and failed presets from noAmiCount to avoid redundant messages
    const noAmiCount = presets.filter(
      (p) => p.amiId === null && p.status !== "building" && p.status !== "failed"
    ).length;

    if (status === "ready") {
      return presets.length === 1 ? "All presets ready" : `All ${presets.length} presets ready`;
    }

    const parts: string[] = [];

    if (buildingCount > 0) {
      parts.push(`${buildingCount} preset${buildingCount > 1 ? "s" : ""} building`);
    }

    if (failedCount > 0) {
      parts.push(`${failedCount} preset${failedCount > 1 ? "s" : ""} failed`);
    }

    if (noAmiCount > 0) {
      parts.push(`${noAmiCount} preset${noAmiCount > 1 ? "s" : ""} without AMI`);
    }

    if (readyCount > 0 && parts.length > 0) {
      parts.unshift(`${readyCount} preset${readyCount > 1 ? "s" : ""} ready`);
    }

    return parts.join(", ");
  }

  test("generates correct message for all ready", () => {
    const presets: AmiState[] = [
      { presetName: "linux-x64", status: "ready", amiId: "ami-123" },
      { presetName: "linux-arm64", status: "ready", amiId: "ami-456" },
    ];
    expect(generateMessage(presets, "ready")).toBe("All 2 presets ready");
  });

  test("generates correct message for single ready preset", () => {
    const presets: AmiState[] = [
      { presetName: "linux-x64", status: "ready", amiId: "ami-123" },
    ];
    expect(generateMessage(presets, "ready")).toBe("All presets ready");
  });

  test("generates correct message for building", () => {
    const presets: AmiState[] = [
      { presetName: "linux-x64", status: "building", amiId: null },
    ];
    expect(generateMessage(presets, "building")).toBe("1 preset building");
  });

  test("generates correct message for mixed status", () => {
    const presets: AmiState[] = [
      { presetName: "linux-x64", status: "ready", amiId: "ami-123" },
      { presetName: "linux-arm64", status: "building", amiId: null },
      { presetName: "custom", status: "failed", amiId: null },
    ];
    expect(generateMessage(presets, "degraded")).toBe(
      "1 preset ready, 1 preset building, 1 preset failed"
    );
  });

  test("generates correct message for empty presets", () => {
    expect(generateMessage([], "degraded")).toBe("No presets configured");
  });
});
