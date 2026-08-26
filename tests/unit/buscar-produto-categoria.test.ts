/**
 * O filtro de categoria do `buscar_produto`.
 *
 * O catálogo da loja tem 3.049 acessórios contra 105 aparelhos, e a busca
 * ordena por estoque: capinha de Poco X6 tem 111 unidades, celular Poco tem 1
 * a 15. Buscar "poco" com o limite padrão de 8 devolvia oito capinhas e nenhum
 * telefone — e o agente respondeu ao cliente que não havia Poco na loja.
 * Havia quinze, somando R$ 1.900 a R$ 3.250.
 *
 * Por isso o que se testa aqui é o FILTRO chegar à query, não o texto do
 * `describe` da tool: um schema com campo bonito que o handler ignora passa no
 * typecheck e reproduz o defeito inteiro.
 */
import { describe, expect, it } from "vitest";

import { buscarProduto } from "@/lib/mcp/tools/produtos-galega";
import type { McpContext } from "@/lib/mcp/types";

const ORG = "aaaaaaaa-1111-4111-8111-111111111111";

interface Espiao {
  ctx: McpContext;
  filtros: Record<string, unknown>;
}

/** Supabase de mentira que registra os `.eq()` aplicados e devolve `linhas`. */
function supabaseEspiao(linhas: unknown[]): Espiao {
  const filtros: Record<string, unknown> = {};
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: (col: string, val: unknown) => {
      filtros[col] = val;
      return q;
    },
    gt: (col: string, val: unknown) => {
      filtros[`${col}__gt`] = val;
      return q;
    },
    ilike: (col: string, val: unknown) => {
      filtros[`${col}__ilike`] = val;
      return q;
    },
    order: () => q,
    // `limit` devolve o BUILDER, não uma Promise — é assim no supabase-js, e é o
    // que permite ao handler encadear `.eq()`/`.gt()` depois dele. Um duplo que
    // resolve aqui quebra justamente o caminho que este teste existe para cobrir.
    limit: () => q,
    then: (resolve: (v: unknown) => unknown) => resolve({ data: linhas, error: null }),
  });
  const supabase = { from: () => q };
  return { ctx: { supabase, organizationId: ORG } as unknown as McpContext, filtros };
}

const UM_APARELHO = [
  { sku: "1", name: "APARELHO POCO X7 12/512GB GREEN", category: "Aparelho", condition: "lacrado", price_cents: 192000, stock_qty: 2 },
];

describe("buscar_produto — filtro de categoria", () => {
  it("categoria='Aparelho' chega à query como filtro de category", async () => {
    const { ctx, filtros } = supabaseEspiao(UM_APARELHO);

    await buscarProduto.handler(
      { termo: "poco", categoria: "Aparelho", limite: 8, somente_disponiveis: true },
      ctx,
    );

    expect(filtros.category).toBe("Aparelho");
    // O tenant nunca sai do input — vem do contexto (service role bypassa RLS).
    expect(filtros.organization_id).toBe(ORG);
  });

  it("sem categoria, não filtra por category — busca de acessório continua ampla", async () => {
    const { ctx, filtros } = supabaseEspiao(UM_APARELHO);

    await buscarProduto.handler({ termo: "capinha", limite: 8, somente_disponiveis: true }, ctx);

    expect(filtros.category).toBeUndefined();
  });

  it("resultado vazio devolve a sugestão de buscar pela marca, não só o aviso", async () => {
    const { ctx } = supabaseEspiao([]);

    const res = (await buscarProduto.handler(
      { termo: "poco x6", categoria: "Aparelho", limite: 8, somente_disponiveis: true },
      ctx,
    )) as { aviso?: string; sugestao?: string };

    // Sem isto o agente encerra o assunto em cima de uma busca que ele mesmo
    // estreitou — que é exatamente como ele afirmou não haver Poco nenhum.
    expect(res.aviso).toBeDefined();
    expect(res.sugestao).toMatch(/marca/i);
  });
});
