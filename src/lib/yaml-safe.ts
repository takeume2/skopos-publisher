import yaml from "js-yaml";

export const MAX_YAML_INPUT_BYTES = 64 * 1024;
export const MAX_YAML_ALIASES = 25;
export const MAX_YAML_DEPTH = 20;
export const MAX_YAML_NODES = 1000;

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function getUtf8ByteLength(text: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text).length;
  }
  return text.length * 2;
}

function countPotentialAliases(rawYaml: string): number {
  if (!rawYaml.includes("&")) return 0;
  const matches = rawYaml.match(/(?:^|[\s[\]{},:])\*[A-Za-z0-9_-]+/gm);
  return matches ? matches.length : 0;
}

interface SanitizeBudget {
  nodes: number;
  exceeded: boolean;
}

function sanitizeYamlValue(
  value: unknown,
  depth: number,
  budget: SanitizeBudget
): unknown {
  if (budget.exceeded) return undefined;
  budget.nodes += 1;
  if (budget.nodes > MAX_YAML_NODES || depth > MAX_YAML_DEPTH) {
    budget.exceeded = true;
    return undefined;
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      out.push(sanitizeYamlValue(item, depth + 1, budget));
      if (budget.exceeded) return undefined;
    }
    return out;
  }

  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return null;
    }

    const out: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      const sanitized = sanitizeYamlValue(entryValue, depth + 1, budget);
      if (budget.exceeded) return undefined;
      Object.defineProperty(out, key, {
        value: sanitized,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }

  return null;
}

/**
 * Safely parses YAML frontmatter into a plain key-value record using js-yaml's JSON_SCHEMA.
 * Rejects custom/non-JSON YAML tags (e.g., !!timestamp, !!binary, !!js/function),
 * strips prototype-polluting keys, and guards against oversized or alias-bomb inputs.
 */
export function parseSafeYamlRecord(
  rawYaml: string
): Record<string, unknown> | null {
  if (!rawYaml || !rawYaml.trim()) return null;
  if (getUtf8ByteLength(rawYaml) > MAX_YAML_INPUT_BYTES) return null;
  if (countPotentialAliases(rawYaml) > MAX_YAML_ALIASES) return null;

  try {
    const loaded = yaml.load(rawYaml, {
      schema: yaml.JSON_SCHEMA,
      json: true,
    });

    if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) {
      return null;
    }

    const budget: SanitizeBudget = { nodes: 0, exceeded: false };
    const sanitized = sanitizeYamlValue(loaded, 0, budget);
    if (
      budget.exceeded ||
      !sanitized ||
      typeof sanitized !== "object" ||
      Array.isArray(sanitized)
    ) {
      return null;
    }

    return sanitized as Record<string, unknown>;
  } catch {
    return null;
  }
}
