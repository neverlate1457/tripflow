export interface PlanningAIConfiguration {
  provider: string;
  openAIKey?: string;
  openAIModel?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ollamaTimeoutMs?: number;
  rerankEnabled?: boolean;
  rerankTimeoutMs?: number;
  rerankMaxCandidates?: number;
}

type EnvironmentSource = Record<string, unknown>;

function stringValue(
  name: string,
  viteEnvironment: EnvironmentSource,
  runtimeEnvironment: NodeJS.ProcessEnv,
) {
  const viteValue = viteEnvironment[name];
  if (typeof viteValue === "string" && viteValue.trim()) return viteValue.trim();
  const runtimeValue = runtimeEnvironment[name];
  return runtimeValue?.trim() || undefined;
}

/**
 * Astro/Vite loads .env files into import.meta.env. Existing process variables
 * are already given precedence by Vite while constructing that object. Keep
 * process.env as a fallback for standalone Node execution and focused tests.
 */
export function resolvePlanningAIConfiguration(
  viteEnvironment: EnvironmentSource = import.meta.env,
  runtimeEnvironment: NodeJS.ProcessEnv = process.env,
  development = import.meta.env.DEV,
): PlanningAIConfiguration {
  const timeout = Number(
    stringValue("OLLAMA_PLANNING_TIMEOUT_MS", viteEnvironment, runtimeEnvironment),
  );
  const rerankTimeout = Number(stringValue("PLANNING_AI_RERANK_TIMEOUT_MS", viteEnvironment, runtimeEnvironment));
  const rerankCandidates = Number(stringValue("PLANNING_AI_RERANK_MAX_CANDIDATES", viteEnvironment, runtimeEnvironment));
  return {
    provider:
      stringValue("PLANNING_AI_PROVIDER", viteEnvironment, runtimeEnvironment) ??
      (development ? "mock" : "openai"),
    openAIKey: stringValue("OPENAI_API_KEY", viteEnvironment, runtimeEnvironment),
    openAIModel: stringValue(
      "OPENAI_PLANNING_MODEL",
      viteEnvironment,
      runtimeEnvironment,
    ),
    ollamaBaseUrl: stringValue(
      "OLLAMA_BASE_URL",
      viteEnvironment,
      runtimeEnvironment,
    ),
    ollamaModel: stringValue(
      "OLLAMA_PLANNING_MODEL",
      viteEnvironment,
      runtimeEnvironment,
    ),
    ollamaTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : undefined,
    rerankEnabled: stringValue("PLANNING_AI_RERANK_ENABLED", viteEnvironment, runtimeEnvironment)?.toLowerCase() === "true",
    rerankTimeoutMs: Number.isFinite(rerankTimeout) && rerankTimeout > 0 ? Math.min(rerankTimeout, 30_000) : 12_000,
    rerankMaxCandidates: Number.isInteger(rerankCandidates) && rerankCandidates > 0 ? Math.min(rerankCandidates, 12) : 12,
  };
}
