/**
 * Capacidades de CATÁLOGO PRÓPRIO — buscar produto e calcular parcelamento com
 * a tabela de taxa real da maquininha. Específico do negócio da Galega Imports
 * (ver `lib/mcp/tools/catalogo/produtos-galega.ts` e a migration 0169).
 *
 * Service role bypassa RLS: TODA query filtra `organization_id` manualmente, e
 * a fonte é sempre `ctx.organizationId` (token/cookie), NUNCA o input.
 */
import { z } from "zod";

import type { McpToolDefinition } from "../types";

// ---------------------------------------------------------------------------
// buscar produto no catálogo próprio
// ---------------------------------------------------------------------------

const buscarProdutoInputShape = {
  termo: z.string().trim().min(2).describe("Parte do nome do produto (ex: 'iphone 13', 'jbl go 4')."),
  /**
   * O filtro que decide se o agente ACHA o celular.
   *
   * A ordenação é por estoque, e o catálogo tem 3.049 acessórios contra 105
   * aparelhos — capinha tem 111 unidades, celular tem 1 a 15. Buscar "poco"
   * sem categoria devolvia oito capinhas e nenhum telefone, e o agente
   * concluía, com a autoridade de quem consultou, que não havia Poco nenhum
   * na loja. Havia quinze.
   */
  categoria: z
    .enum(["Aparelho", "Acessório"])
    .optional()
    .describe(
      "Filtra por tipo. Use 'Aparelho' quando o cliente pergunta por um CELULAR — sem isso os " +
        "acessórios do mesmo modelo (capinha, película, bateria) ocupam a resposta inteira.",
    ),
  limite: z.number().int().min(1).max(20).optional().default(8),
  somente_disponiveis: z.boolean().optional().default(true),
};

export const buscarProduto: McpToolDefinition<typeof buscarProdutoInputShape> = {
  name: "buscar_produto",
  description:
    "Busca produtos no catálogo próprio da loja por parte do nome. Devolve categoria, condição " +
    "(lacrado/seminovo/vitrine), preço e estoque reais. Use sempre que o cliente citar um produto " +
    "específico, antes de responder qualquer coisa sobre preço ou disponibilidade. " +
    "Para CELULAR, passe categoria='Aparelho'. Se o modelo exato não aparecer, busque de novo só " +
    "pela MARCA (ex: termo='poco', categoria='Aparelho') antes de dizer que não tem — não ter " +
    "aquele modelo não significa não ter nada da marca.",
  inputSchema: buscarProdutoInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    let q = ctx.supabase
      .from("store_products")
      .select("sku, name, category, condition, price_cents, stock_qty")
      .eq("organization_id", ctx.organizationId)
      .eq("active", true)
      .ilike("name", `%${input.termo}%`)
      .order("stock_qty", { ascending: false })
      .limit(input.limite);

    if (input.categoria) q = q.eq("category", input.categoria);
    if (input.somente_disponiveis) q = q.gt("stock_qty", 0);

    const { data, error } = await q;
    if (error) throw new Error(`buscar_produto_falhou: ${error.message}`);

    return {
      produtos: data ?? [],
      // O aviso diz o que fazer A SEGUIR, e não só que deu vazio. Zero
      // resultado para um modelo específico é a hora de olhar a marca inteira
      // — sem isso o agente encerra o assunto em cima de uma busca que ele
      // mesmo estreitou demais.
      ...(data && data.length === 0
        ? {
            aviso: input.somente_disponiveis
              ? "nada com esse nome em estoque"
              : "nada com esse nome no catálogo",
            sugestao:
              "Antes de dizer ao cliente que não tem, busque de novo só pela marca " +
              "(ex: termo='poco', categoria='Aparelho') e ofereça o que existir.",
          }
        : {}),
    };
  },
};

// ---------------------------------------------------------------------------
// calcular parcelamento no cartão
// ---------------------------------------------------------------------------

const calcularParcelamentoInputShape = {
  valor: z.number().positive().describe("Valor total da compra em reais (ex: 2200)."),
  parcelas: z.number().int().min(1).max(18).describe("Número de parcelas que o cliente quer, de 1 a 18."),
  /**
   * O total com juros SÓ SAI SE PEDIREM, e a razão é de venda, não de cálculo.
   *
   * O dono da loja é explícito: "3x de 698" vende, "2.094 no total" derruba a
   * conversa. O prompt já mandava dizer só a parcela — e o agente disse a
   * parcela e, na mensagem seguinte, o total assim mesmo. Instrução negativa
   * não vence dado presente: enquanto o número estiver na resposta da
   * ferramenta, ele acaba na tela do cliente.
   *
   * Então quem decide é o input, não a disciplina do modelo. Quando o cliente
   * pergunta o total, o agente chama de novo com `incluir_total: true` — e aí
   * o número existe porque alguém pediu.
   */
  incluir_total: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Só marque true se o cliente PERGUNTOU o valor total com juros. Por padrão a resposta traz " +
        "apenas o valor da parcela, que é o que se diz a quem está comprando.",
    ),
};

export const calcularParcelamento: McpToolDefinition<typeof calcularParcelamentoInputShape> = {
  name: "calcular_parcelamento",
  description:
    "Calcula o valor exato de cada parcela no cartão, com a taxa real da maquininha embutida. " +
    "Use sempre que o cliente perguntar quanto fica parcelado ou no cartão — nunca calcule de cabeça. " +
    "Diga ao cliente o valor da PARCELA. O total com juros só vem se você pedir com incluir_total.",
  inputSchema: calcularParcelamentoInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("installment_fee_rates")
      .select("fee_percent")
      .eq("organization_id", ctx.organizationId)
      .eq("installments", input.parcelas)
      .maybeSingle();

    if (error) throw new Error(`calcular_parcelamento_falhou: ${error.message}`);
    if (!data) return { aviso: `sem taxa cadastrada para ${input.parcelas}x — não é possível calcular` };

    const totalComTaxa = input.valor * (1 + Number(data.fee_percent) / 100);
    return {
      parcelas: input.parcelas,
      valorParcela: Math.round((totalComTaxa / input.parcelas) * 100) / 100,
      ...(input.incluir_total ? { totalComTaxa: Math.round(totalComTaxa * 100) / 100 } : {}),
    };
  },
};
