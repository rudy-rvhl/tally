/**
 * Optional AI interpretation of a question into the same QuerySpec the rule-based
 * parser produces. The model only chooses filters (ids, dates, intent). It never
 * sees amounts and never produces a number shown to the user.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { QuerySpecSchema, type AskEntities, type QuerySpec } from "../engine/ask";
import { log } from "../log";

export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;

export async function interpretWithAI(question: string, entities: AskEntities, today: string): Promise<QuerySpec | null> {
  if (!aiEnabled()) return null;
  const client = new Anthropic();
  const system = [
    "You convert a business owner's question about their spending into a JSON query for a bookkeeping database.",
    "Only pick ids from the provided lists. Leave a list empty when the question doesn't mention it.",
    "Dates are YYYY-MM-DD, inclusive. A month without a year means its most recent occurrence on or before today.",
    "intent: total (how much), list (show transactions), top (largest N, set limit), compare (two periods; set compareFrom/compareTo/compareLabel for the second, earlier period), price_increases (recurring charges that went up), count (how many), by_supplier, by_category.",
    "flow: income for money received, spending for money spent, all when both.",
    "rangeLabel is a short human phrase like 'in October 2026' or 'this year so far'.",
  ].join("\n");
  try {
    const response = await client.messages.parse({
      model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
      max_tokens: 2048,
      output_config: { effort: "low", format: zodOutputFormat(QuerySpecSchema) },
      system,
      messages: [{
        role: "user",
        content: `Today is ${today}.\nSuppliers: ${JSON.stringify(entities.merchants)}\nCategories: ${JSON.stringify(entities.categories)}\nAccounts: ${JSON.stringify(entities.accounts.map(({ id, name, institution, type }) => ({ id, name, institution, type })))}\n\nQuestion: ${question}`,
      }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) return null;
    const spec = response.parsed_output;
    // Never trust ids we didn't offer.
    const ok = (ids: string[], pool: { id: string }[]) => ids.filter((id) => pool.some((p) => p.id === id));
    return { ...spec, merchantIds: ok(spec.merchantIds, entities.merchants), categoryIds: ok(spec.categoryIds, entities.categories), accountIds: ok(spec.accountIds, entities.accounts) };
  } catch (e) {
    if (e instanceof Anthropic.APIError) log("warn", "ai.interpret.failed", { status: e.status ?? null });
    else log("warn", "ai.interpret.failed", { error: (e as Error).name });
    return null;
  }
}
