import type { ManagedPolicySummary } from "@t3tools/contracts";
import * as RelayTracing from "@t3tools/shared/relayTracing";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

/** External relay tracing is permanently disabled in this fork. */
export const allowedFor = (
  _env: Readonly<Record<string, string | undefined>>,
  _policy: ManagedPolicySummary | undefined,
): boolean => false;

/** External relay tracing is permanently disabled in this fork. */
export const relayLayer = (
  _resource: Omit<RelayTracing.RelayClientTracingResource, "serviceInstanceId">,
  _tracingConfig?: RelayTracing.RelayClientTracingConfig | null,
) => Layer.succeed(RelayTracing.RelayClientTracer, Option.none());

export const layerHeadlessRelayClient = relayLayer({
  serviceName: "t3code-server",
  runtime: "node",
  client: "headless-cli",
});

export const layerServerRelayBroker = relayLayer({
  serviceName: "t3code-server",
  runtime: "node",
  client: "environment-server",
  component: "relay-broker",
});
