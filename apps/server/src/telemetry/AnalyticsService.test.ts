import { it, assert } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as AnalyticsService from "./AnalyticsService.ts";

it.layer(AnalyticsService.layer)("AnalyticsService (telemetry permanently disabled)", (it) => {
  it.effect("record, recordOwners, and flush are no-ops without network or identity reads", () =>
    Effect.gen(function* () {
      const analytics = yield* AnalyticsService.AnalyticsService;
      const recorded = yield* analytics.record("server.boot.heartbeat", {
        threadCount: 1,
        projectCount: 1,
      });
      assert.isFalse(recorded);
      yield* analytics.recordOwners([{ source: "connect", ownerId: "hashed-owner" }], "server");
      yield* analytics.flush;
    }).pipe(Effect.provide(Layer.empty)),
  );
});

it("reports a WSL distro by its family, never by a name its user chose", () => {
  assert.equal(AnalyticsService.wslDistroFamily("Ubuntu-24.04"), "Ubuntu");
  assert.equal(AnalyticsService.wslDistroFamily("openSUSE-Tumbleweed"), "openSUSE");
  assert.equal(AnalyticsService.wslDistroFamily("Acme-Client-Secret-Ubuntu"), "other");
  assert.equal(AnalyticsService.wslDistroFamily("  "), undefined);
});
