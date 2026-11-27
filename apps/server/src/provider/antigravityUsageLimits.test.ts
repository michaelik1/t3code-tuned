import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import {
  ANTIGRAVITY_CLI_USAGE_ARGS,
  buildAntigravityUsageCliEnv,
  makeAntigravityUsageProbe,
  parseAntigravityCliUsageOutput,
} from "./antigravityUsageLimits.ts";

const makeFakeSpawner = (
  handler: (input: {
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly env: NodeJS.ProcessEnv | undefined;
    readonly cwd: string | undefined;
  }) => Effect.Effect<
    { readonly stdout: string; readonly stderr?: string; readonly exitCode?: number },
    PlatformError.PlatformError
  >,
) =>
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        if (command._tag !== "StandardCommand") {
          throw new Error(`Unexpected command tag: ${command._tag}`);
        }
        const env: NodeJS.ProcessEnv | undefined = command.options.env
          ? Object.fromEntries(
              Object.entries(command.options.env).map(([key, value]) => [
                key,
                typeof value === "string" || value === undefined ? value : Redacted.value(value),
              ]),
            )
          : undefined;
        const response = yield* handler({
          command: command.command,
          args: command.args.map((arg) => (typeof arg === "string" ? arg : Redacted.value(arg))),
          env,
          cwd: command.options.cwd,
        });
        const stdoutBytes = new TextEncoder().encode(response.stdout);
        const stderrBytes = new TextEncoder().encode(response.stderr ?? "");
        const exitCode = ChildProcessSpawner.ExitCode(response.exitCode ?? 0);
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(12345),
          exitCode: Effect.succeed(exitCode),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          unref: Effect.succeed(Effect.void),
          stdin: {} as never,
          stdout: Stream.make(stdoutBytes),
          stderr: Stream.make(stderrBytes),
          all: Stream.make(stdoutBytes),
          getInputFd: () => ({}) as never,
          getOutputFd: () => Stream.empty,
        });
      }),
    ),
  );

describe("parseAntigravityCliUsageOutput", () => {
  const requestedAt = Date.parse("2026-11-28T00:00:00Z");

  it("parses Gemini and Claude/GPT 5h and weekly windows and drops epoch/untouched resets", () => {
    const stdout = JSON.stringify({
      status: "SUCCESS",
      num_turns: 0,
      command: {
        name: "usage",
        data: {
          groups: [
            {
              name: "Gemini Models",
              buckets: [
                {
                  id: "gemini-weekly",
                  name: "Weekly Limit Remaining",
                  window: "weekly",
                  remaining_fraction: 0.715,
                  reset_time: "2026-12-03T17:46:57Z",
                },
                {
                  id: "gemini-5h",
                  name: "Five Hour Limit Remaining",
                  window: "5h",
                  remaining_fraction: 1,
                  // Rolling untouched window (exactly requestedAt + 5h) -> omit resetsAt
                  reset_time: "2026-11-28T05:00:00Z",
                },
              ],
            },
            {
              name: "Claude and GPT models",
              buckets: [
                {
                  id: "3p-weekly",
                  name: "Weekly Limit Remaining",
                  window: "weekly",
                  remaining_fraction: 1,
                  // Epoch placeholder -> omit resetsAt
                  reset_time: "1970-01-01T00:00:00Z",
                },
                {
                  id: "3p-5h",
                  name: "Five Hour Limit Remaining",
                  window: "5h",
                  remaining_fraction: 0.87,
                  reset_time: "2026-11-28T04:36:56Z",
                },
              ],
            },
          ],
        },
      },
    });

    const windows = parseAntigravityCliUsageOutput(stdout, requestedAt);
    expect(windows).toEqual([
      {
        id: "gemini-weekly",
        label: "Gemini · Weekly",
        kind: "weekly",
        usedPercent: expect.closeTo(28.5, 5),
        resetsAt: "2026-12-03T17:46:57.000Z",
        windowDurationMins: 7 * 24 * 60,
      },
      {
        id: "gemini-5h",
        label: "Gemini · 5-hour",
        kind: "session",
        usedPercent: 0,
        windowDurationMins: 5 * 60,
      },
      {
        id: "3p-weekly",
        label: "Claude & GPT (shared) · Weekly",
        kind: "weekly",
        usedPercent: 0,
        windowDurationMins: 7 * 24 * 60,
      },
      {
        id: "3p-5h",
        label: "Claude & GPT (shared) · 5-hour",
        kind: "session",
        usedPercent: expect.closeTo(13, 5),
        resetsAt: "2026-11-28T04:36:56.000Z",
        windowDurationMins: 5 * 60,
      },
    ]);
  });

  it("returns empty array for non-success status or malformed JSON", () => {
    expect(parseAntigravityCliUsageOutput("not json", requestedAt)).toEqual([]);
    expect(
      parseAntigravityCliUsageOutput(
        JSON.stringify({ status: "ERROR", command: { name: "usage", data: { groups: [] } } }),
        requestedAt,
      ),
    ).toEqual([]);
  });
});

describe("buildAntigravityUsageCliEnv", () => {
  it.effect("isolates Windows profile variables and strips ambient credentials", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const env = buildAntigravityUsageCliEnv({
        platform: "win32",
        baseEnv: {
          PATH: "C:\\Windows\\System32",
          GOOGLE_API_KEY: "secret",
          GEMINI_HOME: "C:\\Users\\real\\.gemini",
          USERPROFILE: "C:\\Users\\real",
          DISPLAY: ":0",
        },
        tempHome: "C:\\Temp\\t3-agy-usage-abc",
        tempSubdir: "C:\\Temp\\t3-agy-usage-abc\\tmp",
        geminiHome: "C:\\Temp\\t3-agy-usage-abc\\.gemini",
        path,
      });
      expect(env.GOOGLE_API_KEY).toBeUndefined();
      expect(env.DISPLAY).toBeUndefined();
      expect(env.USERPROFILE).toBe("C:\\Temp\\t3-agy-usage-abc");
      expect(env.HOME).toBe("C:\\Temp\\t3-agy-usage-abc");
      expect(env.HOMEDRIVE).toBe("C:");
      expect(env.HOMEPATH).toBe("\\Temp\\t3-agy-usage-abc");
      expect(env.GEMINI_HOME).toBe("C:\\Temp\\t3-agy-usage-abc\\.gemini");
      expect(env.AGY_CLI_FORCE_FILE_TOKEN_STORAGE).toBe("1");
      expect(env.AGY_CLI_DISABLE_AUTO_UPDATE).toBe("true");
      expect(env.BROWSER).toBe("echo");
      expect(env.CI).toBe("true");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("makeAntigravityUsageProbe", () => {
  it.effect("returns unsupported for API-key auth without spawning agy", () =>
    Effect.gen(function* () {
      let spawned = 0;
      const probe = yield* makeAntigravityUsageProbe({
        profileDirectory: "/unused",
        authMethod: "gemini-api-key",
        baseEnv: {},
        acquireExecutable: Effect.succeed({ executablePath: "/bin/agy" }),
      }).pipe(
        Effect.provide(
          makeFakeSpawner(() => {
            spawned++;
            return Effect.succeed({ stdout: "{}" });
          }),
        ),
      );
      const result = yield* probe.probe;
      expect(result.unavailable?.reason).toBe("unsupported");
      expect(spawned).toBe(0);
    }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  it.effect("returns unsupported when profile has no antigravity-oauth-token", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const profileDirectory = yield* fs.makeTempDirectoryScoped({ prefix: "agy-profile-" });
        let spawned = 0;
        const probe = yield* makeAntigravityUsageProbe({
          profileDirectory,
          authMethod: "oauth-personal",
          baseEnv: {},
          acquireExecutable: Effect.succeed({ executablePath: "/bin/agy" }),
        }).pipe(
          Effect.provide(
            makeFakeSpawner(() => {
              spawned++;
              return Effect.succeed({ stdout: "{}" });
            }),
          ),
        );
        const result = yield* probe.probe;
        expect(result.unavailable?.reason).toBe("unsupported");
        expect(spawned).toBe(0);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  it.effect(
    "stages the profile token into an isolated home, parses /usage JSON, caches, and cleans up",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const profileDirectory = yield* fs.makeTempDirectoryScoped({ prefix: "agy-profile-" });
          const acpDir = path.join(profileDirectory, "antigravity-acp");
          yield* fs.makeDirectory(acpDir, { recursive: true });
          const tokenBody = JSON.stringify({
            id_token_email: "alice@example.com",
            auth_method: "oauth-personal",
            token: { access_token: "tok_123", refresh_token: "ref_123" },
          });
          yield* fs.writeFileString(path.join(acpDir, "antigravity-oauth-token"), tokenBody);

          let calls = 0;
          let observedStagedToken: string | undefined;
          let observedTempHome: string | undefined;

          const probe = yield* makeAntigravityUsageProbe({
            profileDirectory,
            authMethod: "oauth-personal",
            baseEnv: { PATH: "/usr/bin" },
            acquireExecutable: Effect.succeed({ executablePath: "/bin/agy" }),
            cacheTtlMs: 60_000,
          }).pipe(
            Effect.provide(
              makeFakeSpawner(({ args, env }) =>
                Effect.gen(function* () {
                  calls++;
                  expect(args).toEqual([...ANTIGRAVITY_CLI_USAGE_ARGS]);
                  observedTempHome = env?.HOME;
                  const stagedPath = path.join(
                    env!.HOME!,
                    ".gemini",
                    "antigravity-cli",
                    "antigravity-oauth-token",
                  );
                  observedStagedToken = yield* fs.readFileString(stagedPath);
                  return {
                    stdout: JSON.stringify({
                      status: "SUCCESS",
                      num_turns: 0,
                      command: {
                        name: "usage",
                        data: {
                          groups: [
                            {
                              name: "Claude and GPT models",
                              buckets: [
                                {
                                  id: "3p-5h",
                                  window: "5h",
                                  remaining_fraction: 0.87,
                                  reset_time: "2026-11-28T04:36:56Z",
                                },
                              ],
                            },
                          ],
                        },
                      },
                    }),
                  };
                }),
              ),
            ),
          );

          const first = yield* probe.probe;
          expect(calls).toBe(1);
          expect(observedStagedToken).toBe(tokenBody);
          expect(first.unavailable).toBeUndefined();
          expect(first.credentialFingerprint).toMatch(/^[a-f0-9]{64}$/);
          expect(first.windows).toHaveLength(1);
          expect(first.windows[0]?.id).toBe("3p-5h");
          expect(first.windows[0]?.usedPercent).toBeCloseTo(13, 5);

          // Temp home and staged token must be removed after probe completes.
          expect(yield* fs.exists(observedTempHome!)).toBe(false);

          // Second call within TTL hits cache.
          const second = yield* probe.probe;
          expect(calls).toBe(1);
          expect(second).toEqual(first);

          // Clearing cache forces a fresh CLI read.
          yield* probe.clear;
          yield* probe.probe;
          expect(calls).toBe(2);
        }),
      ).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );
});
