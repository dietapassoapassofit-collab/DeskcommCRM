/**
 * Consulta `in.(...)` partida em lotes — porque a lista de ids vai na URL.
 *
 * ═══ O DEFEITO MEDIDO (06/10/2026) ═══
 *
 * O quadro do funil parou de abrir ("Carregando..." para sempre) quando a
 * SpacePhone passou de 400 negócios. A rota devolvia `500 TypeError: fetch
 * failed` depois de 12s, e a causa real só aparece com a mensagem interna do
 * undici:
 *
 *     crm_lead_scores   FALHOU: fetch failed Headers Overflow Error
 *     lead_state        FALHOU: fetch failed Headers Overflow Error
 *     conversations     FALHOU: fetch failed Headers Overflow Error
 *
 * O PostgREST recebe o filtro na URL: 393 uuids viram `in.(...)` de ~14,7 KB, e
 * com o token do usuário nos cabeçalhos a requisição passa do teto de 16 KB que
 * o Node aceita por padrão. Não é limite do banco nem do PostgREST — é do
 * cliente HTTP, e por isso o erro chega como "fetch failed", sem status.
 *
 * O defeito é de CRESCIMENTO: passou despercebido com 218 negócios e apareceu
 * sozinho em 404. Toda consulta por lista de ids tem esse teto escondido.
 *
 * ═══ POR QUE LOTE, E NÃO BUSCAR A ORGANIZAÇÃO INTEIRA ═══
 *
 * Trocar o `in.(...)` por "pega tudo da organização e filtra no JS" resolveria
 * hoje e quebraria de novo depois, só que em outro lugar — a resposta é que
 * cresceria sem teto. O lote mantém o filtro no banco e limita a URL.
 */

/** 100 uuids ≈ 3,8 KB de URL: folga de 4x para cabeçalho e token. */
export const IDS_POR_LOTE = 100;

export function emLotes<T>(itens: readonly T[], tamanho = IDS_POR_LOTE): T[][] {
  if (itens.length === 0) return [];
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

/**
 * Roda a consulta uma vez por lote de ids e junta as linhas.
 *
 * Os lotes vão em PARALELO: são independentes, e em série o quadro pagaria uma
 * ida ao Supabase (~250ms) por lote. Um erro em qualquer lote vira o erro do
 * conjunto — meia resposta num quadro é pior que um erro visível.
 */
export async function consultaEmLotes<T, L>(
  ids: readonly L[],
  //  e nao : o construtor de consulta do Supabase e um
  // thenable, nao uma Promise — exigir Promise recusaria o chamador real.
  consulta: (lote: L[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  tamanho = IDS_POR_LOTE,
): Promise<{ data: T[]; error: string | null }> {
  const lotes = emLotes(ids, tamanho);
  if (lotes.length === 0) return { data: [], error: null };

  const respostas = await Promise.all(lotes.map((lote) => consulta(lote)));
  const linhas: T[] = [];
  for (const r of respostas) {
    if (r.error) return { data: [], error: r.error.message };
    if (r.data) linhas.push(...r.data);
  }
  return { data: linhas, error: null };
}
