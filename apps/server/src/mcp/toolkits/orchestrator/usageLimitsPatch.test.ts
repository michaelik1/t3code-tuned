import { expect, it } from "@effect/vitest";
import type { ServerProvider, UsageLimitSourceSnapshot } from "@t3tools/contracts";
import {
  resolveT3McpSummaryAction,
  resolveT3McpToolDefinition,
  resolveT3McpToolPresentation,
} from "@t3tools/shared/t3McpToolPresentation";
import { advertisedJsonSchema } from "../../advertisedJsonSchema.ts";
import { usageLimitsSnapshot } from "./handlers.ts";
import { OrchestratorToolkit } from "./tools.ts";

it("returns every window per account, preserving missing snapshots and source errors", () => {
  const windows = [
    { id: "5h", kind: "session", label: "5h", usedPercent: 25 },
    { id: "weekly-model", kind: "weekly", label: "Model weekly", usedPercent: 80 },
  ];
  const providers = [
    { instanceId: "codex", driver: "codex", enabled: true, usageLimits: { checkedAt: "2026-01-01T00:00:00Z", windows, credentialFingerprint: "private" } },
    { instanceId: "agy", driver: "antigravity", enabled: false },
  ] as unknown as ReadonlyArray<ServerProvider>;
  const sources = [{ label: "hub", error: "offline", accounts: [] }] as unknown as ReadonlyArray<UsageLimitSourceSnapshot>;
  const result = usageLimitsSnapshot(providers, sources);
  expect(result.accounts[0]?.windows).toEqual(windows);
  expect(result.accounts[1]?.unavailable).toBe("no_snapshot");
  expect(result.sourceErrors).toEqual([{ source: "hub", message: "offline" }]);
  expect(JSON.stringify(result)).not.toContain("private");
  expect(OrchestratorToolkit.tools.t3_usage_limits).toBeDefined();
});

it("advertises an object input schema accepted by the MCP server", () => {
  expect(advertisedJsonSchema(OrchestratorToolkit.tools.t3_usage_limits).type).toBe("object");
});

it("resolves T3 icon and presentation labels for t3_usage_limits", () => {
  expect(resolveT3McpToolPresentation("mcp__t3-code__t3_usage_limits")).toEqual({
    displayName: "Get usage limits",
    logo: "t3-code",
  });
  expect(resolveT3McpToolDefinition("t3_usage_limits")?.labels).toEqual([
    "Get",
    "Getting",
    "Got",
    "usage limits",
  ]);
  expect(resolveT3McpSummaryAction("t3_usage_limits", {})).toBe("usage-limits");
});
