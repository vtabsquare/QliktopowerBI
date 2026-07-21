import type { TmdlFolderResult, TomDatabaseSpec } from "./TomModelTypes";
import { serializeTmdlFolder } from "./TmdlSerializer";

export interface TomSerializationOptions {
  preferMicrosoftTom?: boolean;
  requireMicrosoftTom?: boolean;
  timeoutMs?: number;
}

function isTmdlFolderResult(value: unknown): value is TmdlFolderResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TmdlFolderResult>;
  return Boolean(candidate.files && typeof candidate.files === "object" && Array.isArray(candidate.diagnostics));
}

/**
 * Uses the local Microsoft TOM bridge when the app is running on Node/Windows
 * with .NET available. The deterministic TypeScript serializer is a safe
 * fallback for browser-only or hosted environments.
 */
export async function serializeTomModel(
  spec: TomDatabaseSpec,
  options: TomSerializationOptions = {},
): Promise<TmdlFolderResult> {
  let microsoftTomError = "Microsoft TOM serialization was not attempted.";
  if (options.preferMicrosoftTom !== false && typeof fetch === "function") {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000) : undefined;
    try {
      const response = await fetch("/api/tom/serialize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(spec),
        signal: controller?.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && isTmdlFolderResult(payload)) {
        return { ...payload, engine: "microsoft-tom", modelSpec: spec };
      }
      microsoftTomError = typeof payload?.error === "string"
        ? payload.error
        : `Microsoft TOM endpoint returned HTTP ${response.status}.`;
    } catch (error) {
      microsoftTomError = error instanceof Error ? error.message : "Microsoft TOM request failed.";
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  if (options.requireMicrosoftTom) {
    throw new Error(
      `Microsoft TOM roundtrip serialization is required but unavailable: ${microsoftTomError} ` +
      "Install the .NET 8 SDK and run scripts/build-tom-bridge.ps1, or disable the strict TOM requirement to use the portable TMDL fallback.",
    );
  }
  return serializeTmdlFolder(spec);
}
