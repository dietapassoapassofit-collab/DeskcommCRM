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
  limite: z.number().int().min(1).max(20).optional().default(8),
  somente_disponiveis: z.boolean().optional().default(true),
};

export const buscarProduto: McpToolDefinition<typeof buscarProdutoInputShape> = {
  name: "buscar_produto",
  description:
    "Busca produtos no catálogo próprio da loja por parte do nome. Devolve categoria, condição " +
    "(lacrado/seminovo/vitrine), preço e estoque reais. Use sempre que o cliente citar um produto " +
    "específico, antes de responder qualquer coisa sobre preço ou disponibilidade.",
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

    if (input.somente_disponiveis) q = q.gt("stock_qty", 0);

    const { data, error } = await q;
    if (error) throw new Error(`buscar_produto_falhou: ${error.message}`);

    return {
      produtos: data ?? [],
      ...(data && data.length === 0
        ? { aviso: input.somente_disponiveis ? "nada com esse nome em estoque" : "nada com esse nome no catálogo" }
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
};

export const calcularParcelamento: McpToolDefinition<typeof calcularParcelamentoInputShape> = {
  name: "calcular_parcelamento",
  description:
    "Calcula o valor exato de cada parcela no cartão, com a taxa real da maquininha embutida. " +
    "Use sempre que o cliente perguntar quanto fica parcelado ou no cartão — nunca calcule de cabeça.",
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
      totalComTaxa: Math.round(totalComTaxa * 100) / 100,
    };
  },
};
