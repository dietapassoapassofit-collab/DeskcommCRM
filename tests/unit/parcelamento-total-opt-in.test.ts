/**
 * O total com juros é OPT-IN.
 *
 * Regra de venda do dono da loja: "3x de 698" vende, "2.094 no total" derruba a
 * conversa. O prompt já mandava dizer só a parcela — e num teste real o agente
 * disse a parcela e, na mensagem seguinte, o total assim mesmo. Instrução
 * negativa não vence dado presente: enquanto o número vier na resposta da
 * ferramenta, ele chega ao cliente.
 *
 * Por isso o teste é sobre a FORMA da resposta, não sobre o texto do prompt.
 */
import { describe, expect, it } from "vitest";

import { calcularParcelamento } from "@/lib/mcp/tools/produtos-galega";
import type { McpContext } from "@/lib/mcp/types";

const ORG = "aaaaaaaa-1111-4111-8111-111111111111";

/** Supabase de mentira que devolve a taxa pedida (ou nenhuma). */
function ctxComTaxa(feePercent: number | null): McpContext {
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({
      data: feePercent === null ? null : { fee_percent: feePercent },
      error: null,
    }),
  });
  return { supabase: { from: () => q }, organizationId: ORG } as unknown as McpContext;
}

describe("calcular_parcelamento — o total é opt-in", () => {
  it("por padrão devolve só a parcela, sem o total", async () => {
    // A conta de referência do dono: 2.000 em 3x a 4,70% => 3x de 698.
    const res = (await calcularParcelamento.handler(
      { valor: 2000, parcelas: 3, incluir_total: false },
      ctxComTaxa(4.7),
    )) as { valorParcela: number; totalComTaxa?: number };

    expect(res.valorParcela).toBe(698);
    expect(res.totalComTaxa).toBeUndefined();
  });

  it("com incluir_total, o total volta — quem perguntou merece resposta", async () => {
    const res = (await calcularParcelamento.handler(
      { valor: 2000, parcelas: 3, incluir_total: true },
      ctxComTaxa(4.7),
    )) as { valorParcela: number; totalComTaxa?: number };

    expect(res.valorParcela).toBe(698);
    expect(res.totalComTaxa).toBe(2094);
  });

  it("sem taxa cadastrada, avisa em vez de inventar juros", async () => {
    const res = (await calcularParcelamento.handler(
      { valor: 2000, parcelas: 7, incluir_total: false },
      ctxComTaxa(null),
    )) as { aviso?: string; valorParcela?: number };

    expect(res.aviso).toMatch(/sem taxa/i);
    expect(res.valorParcela).toBeUndefined();
  });
});
