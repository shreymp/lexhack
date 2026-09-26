import pack from "@/rules/chicago-rlto.json";
import type { Rule, RulePack } from "@/lib/types";

export const RULE_PACK = pack as RulePack;

const byId = new Map<string, Rule>(RULE_PACK.rules.map((r) => [r.id, r]));

export function getRule(id: string | null | undefined): Rule | undefined {
  return id ? byId.get(id) : undefined;
}

export const PROHIBITED_RULES = RULE_PACK.rules.filter((r) => r.kind === "prohibited_provision");
export const MISSING_RULES = RULE_PACK.rules.filter((r) => r.kind === "missing_protection");
