import type {
  AntigravitySettings,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Digest from "effect/crypto/Digest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { collectUint8StreamText } from "@t3tools/provider-core/server/collectStreamText";
import {
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "@t3tools/provider-core/server/usageLimits";

import type { AntigravityInstallationError } from "./AntigravityInstallation.ts";

const DEFAULT_CACHE_TTL_MS = 15_000;
const DEFAULT_PROBE_TIMEOUT_MS = 25_000;
const MAX_CLI_OUTPUT_BYTES = 1024 * 1024;
const UNTOUCHED_RESET_TOLERANCE_MS = 60_000;

export const ANTIGRAVITY_CLI_USAGE_ARGS = [
  "--print",
  "/usage",
  "--output-format",
  "json",
  "--print-timeout",
  "15s",
] as const;

const SUMMARY_WINDOW_MINS = new Map<string, number>([
  ["5h", 5 * 60],
  ["weekly", 7 * 24 * 60],
]);

const STRIPPED_ENV_KEYS = new Set([
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_CLOUD_QUOTA_PROJECT",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "GCLOUD_PROJECT",
  "CLOUDSDK_CORE_PROJECT",
  "ANTIGRAVITY_HOME",
  "GEMINI_HOME",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "BROWSER",
  "ELECTRON_RUN_AS_NODE",
  "CHROME_CRASHPAD_PIPE_NAME",
]);

const CliTokenFile = Schema.Struct({
  id_token_email: Schema.optional(Schema.String),
  token: Schema.optional(
    Schema.Struct({
      access_token: Schema.optional(Schema.String),
      refresh_token: Schema.optional(Schema.String),
    }),
  ),
});

const CliUsageBucket = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  window: Schema.optional(Schema.String),
  remaining_fraction: Schema.optional(Schema.Number),
  reset_time: Schema.optional(Schema.String),
  disabled: Schema.optional(Schema.Boolean),
});

const CliUsageGroup = Schema.Struct({
  name: Schema.optional(Schema.String),
  display_name: Schema.optional(Schema.String),
  buckets: Schema.optional(Schema.Array(CliUsageBucket)),
});

const CliUsageOutput = Schema.Struct({
  status: Schema.optional(Schema.String),
  command: Schema.optional(
    Schema.Struct({
      name: Schema.optional(Schema.String),
      data: Schema.optional(
        Schema.Struct({
          groups: Schema.optional(Schema.Array(CliUsageGroup)),
          buckets: Schema.optional(Schema.Array(CliUsageBucket)),
        }),
      ),
    }),
  ),
});

const decodeCliTokenFile = Schema.decodeUnknownOption(Schema.fromJsonString(CliTokenFile));
const decodeCliUsageOutput = Schema.decodeUnknownOption(Schema.fromJsonString(CliUsageOutput));

function resolveResetIso(
  resetTime: string | undefined,
  remainingFraction: number,
  windowDurationMins: number | undefined,
  requestedAt: number,
): string | undefined {
  if (!resetTime) return undefined;
  const parsed = DateTime.make(resetTime);
  if (Option.isNone(parsed)) return undefined;
  const epochMs = DateTime.toEpochMillis(parsed.value);
  // agy emits Unix epoch (1970-01-01T00:00:00Z) as a placeholder for inactive buckets.
  if (!Number.isFinite(epochMs) || epochMs <= 0) return undefined;
  // Untouched rolling windows report a full-window reset from now.
  if (
    remainingFraction === 1 &&
    windowDurationMins !== undefined &&
    Math.abs(epochMs - requestedAt - windowDurationMins * 60_000) <= UNTOUCHED_RESET_TOLERANCE_MS
  ) {
    return undefined;
  }
  return DateTime.formatIso(parsed.value);
}

/** Parses JSON returned by `agy --print /usage --output-format json`. */
export function parseAntigravityCliUsageOutput(
  stdout: string,
  requestedAt: number,
): ReadonlyArray<ServerProviderUsageWindow> {
  const decoded = decodeCliUsageOutput(stdout.trim());
  if (Option.isNone(decoded)) return [];
  const output = decoded.value;
  if (output.status !== undefined && output.status !== "SUCCESS") return [];
  if (output.command?.name !== undefined && output.command.name !== "usage") return [];
  const data = output.command?.data;
  if (!data) return [];

  const groups = data.groups?.some((group) => group.buckets?.length)
    ? data.groups
    : [{ name: undefined, display_name: undefined, buckets: data.buckets }];
  const windows = new Map<string, ServerProviderUsageWindow>();

  for (const group of groups ?? []) {
    const groupName = group.display_name?.trim() || group.name?.trim();
    for (const bucket of group.buckets ?? []) {
      if (bucket.disabled) continue;
      if (bucket.remaining_fraction === undefined || !Number.isFinite(bucket.remaining_fraction)) {
        continue;
      }
      const family = bucket.id.startsWith("gemini-argon-")
        ? groupName || "Gemini Argon"
        : bucket.id.startsWith("gemini-carbon-")
          ? groupName || "Gemini Carbon"
          : bucket.id.startsWith("gemini-")
            ? "Gemini"
            : bucket.id.startsWith("3p-")
              ? "Claude & GPT (shared)"
              : groupName || bucket.id;
      const weekly = bucket.window === "weekly" || bucket.id.endsWith("-weekly");
      const session = bucket.window === "5h" || bucket.id.endsWith("-5h");
      const windowKey = weekly ? "weekly" : session ? "5h" : (bucket.window ?? "");
      const windowDurationMins = SUMMARY_WINDOW_MINS.get(windowKey);
      const resetsAt = resolveResetIso(
        bucket.reset_time,
        bucket.remaining_fraction,
        windowDurationMins,
        requestedAt,
      );
      const kind: ServerProviderUsageWindow["kind"] = weekly
        ? "weekly"
        : session
          ? "session"
          : "other";
      const label = `${family} · ${weekly ? "Weekly" : session ? "5-hour" : bucket.name?.trim() || "Quota"}`;
      const clampedRemaining = Math.max(0, Math.min(1, bucket.remaining_fraction));
      windows.set(bucket.id, {
        id: bucket.id,
        label,
        kind,
        usedPercent: (1 - clampedRemaining) * 100,
        ...(resetsAt ? { resetsAt } : {}),
        ...(windowDurationMins === undefined ? {} : { windowDurationMins }),
      });
    }
  }

  return [...windows.values()];
}

export function buildAntigravityUsageCliEnv(input: {
  readonly platform: NodeJS.Platform;
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly tempHome: string;
  readonly tempSubdir: string;
  readonly geminiHome: string;
  readonly path: Path.Path;
}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(input.baseEnv)) {
    if (!STRIPPED_ENV_KEYS.has(key.toUpperCase())) environment[key] = value;
  }
  const winDriveMatch =
    input.platform === "win32" ? /^([A-Za-z]:)(.*)$/.exec(input.tempHome) : null;
  return {
    ...environment,
    HOME: input.tempHome,
    GEMINI_HOME: input.geminiHome,
    AGY_CLI_FORCE_FILE_TOKEN_STORAGE: "1",
    AGY_ACP_FORCE_FILE_STORAGE: "1",
    AGY_CLI_DISABLE_AUTO_UPDATE: "true",
    SSH_CONNECTION: input.baseEnv.SSH_CONNECTION || "127.0.0.1 0 127.0.0.1 0",
    BROWSER: "echo",
    CI: "true",
    ...(input.platform === "win32"
      ? {
          USERPROFILE: input.tempHome,
          ...(winDriveMatch
            ? {
                HOMEDRIVE: winDriveMatch[1],
                HOMEPATH: winDriveMatch[2] || "\\",
              }
            : {}),
          TEMP: input.tempSubdir,
          TMP: input.tempSubdir,
        }
      : {
          TMPDIR: input.tempSubdir,
          XDG_CONFIG_HOME: input.path.join(input.tempHome, ".config"),
          XDG_CACHE_HOME: input.path.join(input.tempHome, ".cache"),
          XDG_DATA_HOME: input.path.join(input.tempHome, ".local", "share"),
        }),
  };
}

const sha256Hex = Effect.fnUntraced(function* (text: string) {
  const digest = yield* (yield* Digest.Digest).digest(
    Digest.sha256,
    new TextEncoder().encode(text),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
});

export const makeAntigravityUsageProbe = Effect.fn("makeAntigravityUsageProbe")(function* (input: {
  readonly profileDirectory: string;
  readonly authMethod: AntigravitySettings["authMethod"];
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly acquireExecutable: Effect.Effect<
    { readonly executablePath: string },
    AntigravityInstallationError,
    Scope.Scope
  >;
  readonly cacheTtlMs?: number;
  readonly timeoutMs?: number;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Digest.Digest;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const platform = yield* HostProcess.Platform;
  const cacheTtlMs = input.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const timeoutMs = input.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;

  let generation = 0;
  let cached:
    | {
        readonly generation: number;
        readonly tokenHash: string;
        readonly expiresAt: number;
        readonly result: ServerProviderUsageLimits;
      }
    | undefined;

  const read = Effect.fn("AntigravityUsageProbe.read")(function* () {
    const startedGeneration = generation;
    const now = yield* Clock.currentTimeMillis;
    const checkedAt = DateTime.formatIso(yield* DateTime.now);

    if (input.authMethod !== "oauth-personal" && input.authMethod !== "oauth-business") {
      return makeUnavailableUsageLimits({
        checkedAt,
        reason: "unsupported",
        message: "Antigravity limits are only available for Google account sign-ins.",
      });
    }

    const acpDir = path.join(input.profileDirectory, "antigravity-acp");
    const tokenPath = path.join(acpDir, "antigravity-oauth-token");
    const rawToken = yield* fs
      .readFileString(tokenPath)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (!rawToken || !rawToken.trim()) {
      return makeUnavailableUsageLimits({
        checkedAt,
        reason: "unsupported",
        message: "Sign in with Google to see Antigravity limits.",
      });
    }

    const tokenHash = yield* sha256Hex(rawToken);
    if (
      cached !== undefined &&
      cached.generation === startedGeneration &&
      cached.tokenHash === tokenHash &&
      cached.expiresAt > now
    ) {
      return cached.result;
    }

    const parsedToken = decodeCliTokenFile(rawToken);
    const email = Option.isSome(parsedToken) ? parsedToken.value.id_token_email?.trim() : undefined;
    const fallbackSecret = Option.isSome(parsedToken)
      ? parsedToken.value.token?.refresh_token || parsedToken.value.token?.access_token
      : undefined;
    const credentialFingerprint = email
      ? yield* sha256Hex(`google-account\0${email.toLowerCase()}`)
      : yield* sha256Hex(`antigravity-cli\0${fallbackSecret || tokenHash}`);

    const settingsPath = path.join(acpDir, "settings.json");
    const rawSettings = yield* fs
      .readFileString(settingsPath)
      .pipe(Effect.orElseSucceed(() => undefined));

    const cliResult = yield* Effect.gen(function* () {
      const executable = yield* input.acquireExecutable;
      const tempHome = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agy-usage-" });
      const geminiHome = path.join(tempHome, ".gemini");
      const cliDir = path.join(geminiHome, "antigravity-cli");
      const tempSubdir = path.join(tempHome, "tmp");
      yield* fs.makeDirectory(cliDir, { recursive: true, mode: 0o700 });
      yield* fs.makeDirectory(tempSubdir, { recursive: true, mode: 0o700 });

      const stagedTokenPath = path.join(cliDir, "antigravity-oauth-token");
      yield* Effect.acquireRelease(
        fs
          .writeFileString(stagedTokenPath, rawToken)
          .pipe(
            Effect.andThen(
              platform !== "win32"
                ? fs.chmod(stagedTokenPath, 0o600).pipe(Effect.ignore)
                : Effect.void,
            ),
          ),
        () => fs.remove(stagedTokenPath, { force: true }).pipe(Effect.ignore),
      );
      if (rawSettings !== undefined) {
        yield* fs
          .writeFileString(path.join(cliDir, "settings.json"), rawSettings)
          .pipe(Effect.ignore);
      }

      const env = buildAntigravityUsageCliEnv({
        platform,
        baseEnv: input.baseEnv,
        tempHome,
        tempSubdir,
        geminiHome,
        path,
      });

      const requestedAt = yield* Clock.currentTimeMillis;
      const child = yield* spawner.spawn(
        ChildProcess.make(executable.executablePath, [...ANTIGRAVITY_CLI_USAGE_ARGS], {
          cwd: tempHome,
          env,
          extendEnv: false,
          shell: false,
          stdin: "ignore",
        }),
      );
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          collectUint8StreamText({ stream: child.stdout, maxBytes: MAX_CLI_OUTPUT_BYTES }),
          collectUint8StreamText({ stream: child.stderr, maxBytes: 16_384 }),
          child.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      return { stdout, stderr, exitCode: Number(exitCode), requestedAt };
    }).pipe(Effect.scoped);

    if (cliResult.exitCode !== 0 || cliResult.stdout.truncated) {
      return makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: "Could not read Antigravity limits. Refresh provider status to retry.",
      });
    }

    const windows = parseAntigravityCliUsageOutput(cliResult.stdout.text, cliResult.requestedAt);
    if (windows.length === 0) {
      return makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: "Antigravity did not return usable quota information.",
      });
    }

    const result: ServerProviderUsageLimits = {
      ...makeUsageLimits({ checkedAt, windows }),
      credentialFingerprint,
    };
    if (generation === startedGeneration && cacheTtlMs > 0) {
      cached = {
        generation: startedGeneration,
        tokenHash,
        expiresAt: (yield* Clock.currentTimeMillis) + cacheTtlMs,
        result,
      };
    }
    return result;
  });

  const probe = read().pipe(
    Effect.provideService(Digest.Digest, crypto),
    Effect.timeout(timeoutMs),
    Effect.catch(() =>
      Effect.gen(function* () {
        return makeUnavailableUsageLimits({
          checkedAt: DateTime.formatIso(yield* DateTime.now),
          reason: "probeFailed",
          message: "Could not read Antigravity limits. Refresh provider status to retry.",
        });
      }),
    ),
  );

  return {
    probe,
    clear: Effect.sync(() => {
      cached = undefined;
      generation++;
    }),
  };
});
