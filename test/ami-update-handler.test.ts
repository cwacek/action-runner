describe("AMI Update Handler - Preset Name Extraction", () => {
  /**
   * Extract preset name from Image Builder ARN.
   * This is a copy of the function for testing.
   */
  function extractPresetName(arn: string): string | null {
    // Extract image name from ARN
    const match = arn.match(/image\/([^/]+)\//);
    if (!match) return null;

    const imageName = match[1];

    // Image name format: spot-runner-<preset-name>-<date>
    // We need to extract the preset name between "spot-runner-" and the date suffix

    // First try: match spot-runner-<preset>-YYYY-MM-DD pattern
    const datePattern = /^spot-runner-(.+?)-\d{4}-\d{2}-\d{2}/;
    const dateMatch = imageName.match(datePattern);
    if (dateMatch) {
      return dateMatch[1];
    }

    // Second try: match spot-runner-<preset>-<any-timestamp-like-suffix>
    const timestampPattern = /^spot-runner-(.+?)-\d+/;
    const timestampMatch = imageName.match(timestampPattern);
    if (timestampMatch) {
      return timestampMatch[1];
    }

    // Third try: if image name starts with spot-runner-, take everything after
    if (imageName.startsWith("spot-runner-")) {
      return imageName.slice("spot-runner-".length);
    }

    // Fallback: use the full image name
    return imageName;
  }

  test("extracts preset name from ARN with date suffix", () => {
    const arn = "arn:aws:imagebuilder:us-east-1:123456789:image/spot-runner-linux-x64-2026-01-27/1.0.0";
    expect(extractPresetName(arn)).toBe("linux-x64");
  });

  test("extracts preset name from ARN with timestamp suffix", () => {
    const arn = "arn:aws:imagebuilder:us-east-1:123456789:image/spot-runner-linux-arm64-1706384400000/1.0.0";
    expect(extractPresetName(arn)).toBe("linux-arm64");
  });

  test("extracts preset name from ARN without date suffix", () => {
    const arn = "arn:aws:imagebuilder:us-east-1:123456789:image/spot-runner-custom-preset/1.0.0";
    expect(extractPresetName(arn)).toBe("custom-preset");
  });

  test("handles preset names with hyphens", () => {
    const arn = "arn:aws:imagebuilder:us-east-1:123456789:image/spot-runner-my-custom-preset-2026-01-27/1.0.0";
    expect(extractPresetName(arn)).toBe("my-custom-preset");
  });

  test("returns null for invalid ARN format", () => {
    const arn = "invalid-arn-format";
    expect(extractPresetName(arn)).toBeNull();
  });

  test("handles ARN without spot-runner prefix", () => {
    const arn = "arn:aws:imagebuilder:us-east-1:123456789:image/some-other-image/1.0.0";
    expect(extractPresetName(arn)).toBe("some-other-image");
  });
});
