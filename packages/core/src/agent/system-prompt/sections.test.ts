import { describe, expect, it } from "vitest";
import {
  buildConditionalToolSections,
  buildIdentitySection,
  buildMemoryFileSection,
  buildProfileDirSection,
  buildRuntimeSection,
  buildSafetySection,
  buildSkillsSection,
  buildSubagentSection,
  buildTimeAwarenessSection,
  buildToolCallStyleSection,
  buildToolingSummary,
  buildUserSection,
  buildWorkspaceSection,
  DEFAULT_BOOTSTRAP_MAX_CHARS,
  DEFAULT_SKILLS_MAX_CHARS,
  truncateWithBudget,
} from "./sections.js";

describe("buildIdentitySection", () => {
  it("returns identity line in full mode (progressive disclosure)", () => {
    // Soul content is no longer injected - agent reads soul.md on demand
    const result = buildIdentitySection({ soul: "You are helpful.", config: { name: "Cleo" } }, "full");
    expect(result).toEqual(["You are Cleo, a Super Multica agent."]);
  });

  it("returns generic identity line in full mode without name", () => {
    const result = buildIdentitySection({ soul: "You are helpful." }, "full");
    expect(result).toEqual(["You are a Super Multica agent."]);
  });

  it("returns identity line with name in none mode", () => {
    const result = buildIdentitySection({ config: { name: "Cleo" } }, "none");
    expect(result).toEqual(["You are Cleo, a Super Multica agent."]);
  });

  it("returns generic identity line in none mode without name", () => {
    const result = buildIdentitySection(undefined, "none");
    expect(result).toEqual(["You are a Super Multica agent."]);
  });

  it("returns identity line in minimal mode", () => {
    const result = buildIdentitySection({ soul: "data", config: { name: "Cleo" } }, "minimal");
    expect(result).toEqual(["You are Cleo, a Super Multica agent."]);
  });
});

describe("buildUserSection", () => {
  it("returns empty in all modes (progressive disclosure)", () => {
    // User content is no longer injected - agent reads user.md on demand
    expect(buildUserSection({ user: "Name: Bob" }, "full")).toEqual([]);
    expect(buildUserSection({ user: "data" }, "minimal")).toEqual([]);
    expect(buildUserSection({}, "full")).toEqual([]);
  });
});

describe("buildWorkspaceSection", () => {
  it("returns workspace content with profile info in full mode", () => {
    const result = buildWorkspaceSection({ workspace: "Rules here" }, "full", "/path/to/profile");
    const text = result.join("\n");
    expect(text).toContain("## Profile");
    expect(text).toContain("/path/to/profile");
    expect(text).toContain("soul.md");
    expect(text).toContain("user.md");
    expect(text).toContain("memory.md");
    expect(text).toContain("Rules here");
  });

  it("returns workspace content without profile dir", () => {
    const result = buildWorkspaceSection({ workspace: "Rules here" }, "full");
    expect(result).toEqual(["Rules here"]);
  });

  it("returns empty in minimal mode", () => {
    expect(buildWorkspaceSection({ workspace: "data" }, "minimal")).toEqual([]);
    expect(buildWorkspaceSection({ workspace: "data" }, "minimal", "/path")).toEqual([]);
  });
});

describe("buildMemoryFileSection", () => {
  it("returns empty in all modes (progressive disclosure)", () => {
    // Memory content is no longer injected - agent reads memory.md on demand
    expect(buildMemoryFileSection({ memory: "Key facts" }, "full")).toEqual([]);
    expect(buildMemoryFileSection({ memory: "data" }, "minimal")).toEqual([]);
  });
});

describe("buildSafetySection", () => {
  it("returns safety text when enabled", () => {
    const result = buildSafetySection(true);
    expect(result.length).toBe(1);
    expect(result[0]).toContain("## Safety");
    expect(result[0]).toContain("no independent goals");
  });

  it("returns empty when disabled", () => {
    expect(buildSafetySection(false)).toEqual([]);
  });
});

describe("buildToolingSummary", () => {
  it("lists core tools with descriptions in order", () => {
    const result = buildToolingSummary(["exec", "read", "write"], "full");
    const text = result.join("\n");
    expect(text).toContain("## Tooling");
    expect(text).toContain("- read: Read file contents");
    expect(text).toContain("- write: Create or overwrite files");
    expect(text).toContain("- exec: Run shell commands");
    // read should appear before exec (order)
    expect(text.indexOf("- read")).toBeLessThan(text.indexOf("- exec"));
  });

  it("appends unknown tools alphabetically", () => {
    const result = buildToolingSummary(["read", "zeta_tool", "alpha_tool"], "full");
    const text = result.join("\n");
    expect(text).toContain("- alpha_tool");
    expect(text).toContain("- zeta_tool");
    expect(text.indexOf("- alpha_tool")).toBeLessThan(text.indexOf("- zeta_tool"));
  });

  it("returns empty for none mode", () => {
    expect(buildToolingSummary(["read"], "none")).toEqual([]);
  });

  it("returns empty for empty tools", () => {
    expect(buildToolingSummary([], "full")).toEqual([]);
  });

  it("works in minimal mode", () => {
    const result = buildToolingSummary(["read"], "minimal");
    expect(result.join("\n")).toContain("## Tooling");
  });

  it("preserves original tool casing", () => {
    const result = buildToolingSummary(["Read", "MyCustomTool", "EXEC"], "full");
    const text = result.join("\n");
    // Core tools: first-seen casing preserved
    expect(text).toContain("- Read: Read file contents");
    expect(text).toContain("- EXEC: Run shell commands");
    // Unknown tools: original casing preserved
    expect(text).toContain("- MyCustomTool");
  });

  it("deduplicates tools by lowercase", () => {
    const result = buildToolingSummary(["read", "Read", "READ"], "full");
    const text = result.join("\n");
    // Should appear only once (first occurrence)
    const matches = text.match(/- read/gi);
    expect(matches).toHaveLength(1);
  });
});

describe("buildToolCallStyleSection", () => {
  it("returns content in full mode", () => {
    const result = buildToolCallStyleSection("full");
    expect(result.join("\n")).toContain("## Tool Call Style");
  });

  it("returns content in minimal mode", () => {
    expect(buildToolCallStyleSection("minimal").length).toBeGreaterThan(0);
  });

  it("returns empty in none mode", () => {
    expect(buildToolCallStyleSection("none")).toEqual([]);
  });
});

describe("buildConditionalToolSections", () => {
  it("includes delegation section when delegate present in full mode", () => {
    const result = buildConditionalToolSections(["delegate"], "full");
    expect(result.join("\n")).toContain("## Delegation");
  });

  it("excludes delegation section in minimal mode", () => {
    const result = buildConditionalToolSections(["delegate"], "minimal");
    expect(result.join("\n")).not.toContain("## Delegation");
  });

  it("includes web access section when web tools present", () => {
    const result = buildConditionalToolSections(["web_search"], "full");
    const text = result.join("\n");
    expect(text).toContain("## Web Access");
    expect(text).toContain("Web usage is conditional, not mandatory");
  });

  it("adds dynamic evidence decision guidance when data tool is present", () => {
    const result = buildConditionalToolSections(["data"], "full");
    const text = result.join("\n");
    expect(text).toContain("## Data Access");
    expect(text).toContain("dynamic evidence decision");
    expect(text).toContain("Make this evidence decision internally");
    expect(text).toContain("user-facing research rationale");
  });

  it("returns empty when no conditional tools match", () => {
    const result = buildConditionalToolSections(["read", "write"], "full");
    expect(result).toEqual([]);
  });

  it("returns empty in none mode", () => {
    expect(buildConditionalToolSections(["read"], "none")).toEqual([]);
  });
});

describe("buildSkillsSection", () => {
  it("wraps skills prompt in full mode", () => {
    const result = buildSkillsSection("## commit\nDo commits.", "full");
    const text = result.join("\n");
    expect(text).toContain("## Skills (mandatory)");
    expect(text).toContain("## commit");
  });

  it("includes inactive skill guidance", () => {
    const result = buildSkillsSection("## commit\nDo commits.", "full");
    const text = result.join("\n");
    expect(text).toContain("inactive skill");
    expect(text).toContain("suggest activating it");
  });

  it("returns empty in minimal mode", () => {
    expect(buildSkillsSection("skills", "minimal")).toEqual([]);
  });

  it("returns empty when skills prompt is empty", () => {
    expect(buildSkillsSection("", "full")).toEqual([]);
    expect(buildSkillsSection(undefined, "full")).toEqual([]);
  });
});

describe("buildRuntimeSection", () => {
  it("formats runtime info in full mode", () => {
    const result = buildRuntimeSection(
      { agentName: "test", os: "darwin", arch: "arm64", nodeVersion: "v22.0.0", timezone: "UTC", model: "claude", provider: "anthropic" },
      "full",
    );
    const text = result.join("\n");
    expect(text).toContain("## Runtime");
    expect(text).toContain("agent=test");
    expect(text).toContain("os=darwin (arm64)");
    expect(text).toContain("model=anthropic/claude");
  });

  it("returns empty in none mode", () => {
    expect(buildRuntimeSection({ os: "darwin" }, "none")).toEqual([]);
  });

  it("returns empty when no runtime provided", () => {
    expect(buildRuntimeSection(undefined, "full")).toEqual([]);
  });
});

describe("buildTimeAwarenessSection", () => {
  it("includes time awareness in full mode", () => {
    const result = buildTimeAwarenessSection(["exec"], "full");
    const text = result.join("\n");
    expect(text).toContain("## Time Awareness");
    expect(text).toContain("latest prefixed timestamp");
    expect(text).toContain("`exec`");
  });

  it("includes time awareness in minimal mode", () => {
    const result = buildTimeAwarenessSection(undefined, "minimal");
    expect(result.join("\n")).toContain("## Time Awareness");
  });

  it("omits time awareness in none mode", () => {
    expect(buildTimeAwarenessSection(["exec"], "none")).toEqual([]);
  });
});

describe("buildProfileDirSection", () => {
  it("returns empty in all modes (merged into workspace section)", () => {
    // Profile directory info is now part of buildWorkspaceSection
    expect(buildProfileDirSection("/path/to/profile", "full")).toEqual([]);
    expect(buildProfileDirSection("/path", "minimal")).toEqual([]);
  });
});

describe("truncateWithBudget", () => {
  it("returns text unchanged when within budget", () => {
    const result = truncateWithBudget("short text", 100);
    expect(result).toEqual({ text: "short text", truncated: false });
  });

  it("truncates text exceeding budget with head + marker + tail", () => {
    const text = "A".repeat(1000);
    const result = truncateWithBudget(text, 200);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("characters omitted");
    expect(result.text).toContain("content truncated to fit system prompt budget");
    // Head should be ~70% of budget = 140 chars of "A"
    expect(result.text.startsWith("A".repeat(100))).toBe(true);
    // Tail should be ~20% of budget = 40 chars of "A"
    expect(result.text.endsWith("A".repeat(40))).toBe(true);
  });

  it("snaps head boundary to newline when possible", () => {
    // Build text with a newline at ~85% of head budget (within the 80-100% snap range)
    const budget = 200;
    // Place a newline at position 120 (> 140*0.8=112, so within snap range)
    const text = "A".repeat(120) + "\n" + "B".repeat(900);
    const result = truncateWithBudget(text, budget);
    expect(result.truncated).toBe(true);
    // Head should snap to the newline at position 120 (not continue to 140)
    const headPortion = result.text.split("characters omitted")[0]!;
    // The head portion should end at the newline, so no "B" chars before the marker
    expect(headPortion).not.toContain("B");
    expect(result.text.startsWith("A".repeat(120))).toBe(true);
  });

  it("reports correct omitted character count", () => {
    const text = "X".repeat(500);
    const result = truncateWithBudget(text, 100);
    expect(result.truncated).toBe(true);
    // head = floor(100*0.7) = 70, tail = floor(100*0.2) = 20, omitted = 500 - 70 - 20 = 410
    expect(result.text).toContain("410 characters omitted");
  });

  it("handles exact budget boundary", () => {
    const text = "A".repeat(100);
    const result = truncateWithBudget(text, 100);
    expect(result).toEqual({ text: text, truncated: false });
  });
});

describe("buildWorkspaceSection budget control", () => {
  it("truncates oversized workspace.md content", () => {
    const oversized = "Line " + "X".repeat(DEFAULT_BOOTSTRAP_MAX_CHARS + 5000);
    const result = buildWorkspaceSection({ workspace: oversized }, "full");
    const text = result.join("\n");
    expect(text).toContain("characters omitted");
    expect(text.length).toBeLessThan(oversized.length);
  });

  it("preserves small workspace.md without truncation", () => {
    const small = "Small workspace rules.";
    const result = buildWorkspaceSection({ workspace: small }, "full");
    const text = result.join("\n");
    expect(text).toContain("Small workspace rules.");
    expect(text).not.toContain("characters omitted");
  });
});

describe("buildSkillsSection budget control", () => {
  it("truncates oversized skills prompt", () => {
    const oversized = "## skill1\n" + "Z".repeat(DEFAULT_SKILLS_MAX_CHARS + 3000);
    const result = buildSkillsSection(oversized, "full");
    const text = result.join("\n");
    expect(text).toContain("characters omitted");
    expect(text).toContain("## Skills (mandatory)");
  });

  it("preserves small skills prompt without truncation", () => {
    const small = "## commit\nDo commits.";
    const result = buildSkillsSection(small, "full");
    const text = result.join("\n");
    expect(text).toContain("## commit");
    expect(text).not.toContain("characters omitted");
  });
});

describe("budget constants", () => {
  it("exports expected default values", () => {
    expect(DEFAULT_BOOTSTRAP_MAX_CHARS).toBe(20_000);
    expect(DEFAULT_SKILLS_MAX_CHARS).toBe(12_000);
  });
});

describe("buildSubagentSection", () => {
  const ctx = { requesterSessionId: "parent", childSessionId: "child", task: "Find bugs" };

  it("returns rules and task in minimal mode", () => {
    const result = buildSubagentSection(ctx, "minimal");
    const text = result.join("\n");
    expect(text).toContain("## Subagent Rules");
    expect(text).toContain("## Task");
    expect(text).toContain("Find bugs");
  });

  it("includes label when provided", () => {
    const result = buildSubagentSection({ ...ctx, label: "Bug Hunter" }, "minimal");
    expect(result.join("\n")).toContain('Label: "Bug Hunter"');
  });

  it("returns empty in full mode", () => {
    expect(buildSubagentSection(ctx, "full")).toEqual([]);
  });

  it("returns empty when no subagent context", () => {
    expect(buildSubagentSection(undefined, "minimal")).toEqual([]);
  });
});
