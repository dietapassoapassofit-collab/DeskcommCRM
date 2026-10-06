import type { Lead } from "@/lib/types/leads";

/**
 * Prefixo que marca um dono AGENTE no filtro (0070). O param de URL continua
 * sendo `owner=` — humano é o uuid puro, agente é `agent:<uuid>`, e o board
 * não precisa de dois seletores para a mesma pergunta ("de quem é isto?").
 */
export const AGENT_OWNER_PREFIX = "agent:";

export function agentOwnerFilter(agentId: string): string {
  return `${AGENT_OWNER_PREFIX}${agentId}`;
}

export function parseAgentOwnerFilter(value: string | undefined): string | null {
  if (!value?.startsWith(AGENT_OWNER_PREFIX)) return null;
  return value.slice(AGENT_OWNER_PREFIX.length) || null;
}

export interface LeadFilters {
  /** userId | `agent:<uuid>` | "any" | "unassigned" */
  owner?: string | "any" | "unassigned";
  status?: "all" | "open" | "won" | "lost";
  tag?: string;
  search?: string;
  valueCentsMin?: number | null;
  valueCentsMax?: number | null;
  overdueOnly?: boolean;
  /**
   * Só quem parou: nenhuma atividade há 24h ou mais — o mesmo limiar que o card
   * usa para escrever "Sem resposta há X dias".
   *
   * Existe para o disparo: o lojista filtra, "Selecionar todos", e o lote já sai
   * só com quem parou. Antes disso ele teria que achar um a um no olho.
   */
  paradosOnly?: boolean;
}

/**
 * Serializa/deserializa os filtros do board em query params (deep-linkável).
 * Só os controles expostos na FilterBar: owner, status, tag, busca, atrasados.
 */
export function filtersFromParams(
  sp: { get(key: string): string | null },
): LeadFilters {
  const owner = sp.get("owner");
  const status = sp.get("status");
  const tag = sp.get("tag");
  const search = sp.get("q");
  return {
    owner: owner ?? undefined,
    status:
      status === "open" || status === "won" || status === "lost" || status === "all"
        ? status
        : "all",
    tag: tag ?? undefined,
    search: search ?? undefined,
    overdueOnly: sp.get("overdue") === "1" || undefined,
    paradosOnly: sp.get("parados") === "1" || undefined,
  };
}

export function filtersToParams(f: LeadFilters): string {
  const p = new URLSearchParams();
  if (f.owner && f.owner !== "any") p.set("owner", f.owner);
  if (f.status && f.status !== "all") p.set("status", f.status);
  if (f.tag) p.set("tag", f.tag);
  if (f.search?.trim()) p.set("q", f.search.trim());
  if (f.overdueOnly) p.set("overdue", "1");
  if (f.paradosOnly) p.set("parados", "1");
  return p.toString();
}

/**
 * Horas sem atividade a partir das quais o negócio conta como parado.
 *
 * É o mesmo limiar de esfriamento do radar (`RISK_COLD_HOURS`). A conta mora
 * aqui, e não vem do radar, porque o radar é paginado: ele devolve no máximo
 * 200 linhas e a Space tem 367 em risco — filtrar por ele mostraria uma fatia e
 * esconderia o resto em silêncio.
 */
export const HORAS_SEM_RESPOSTA = 24;

/** Último sinal de vida: a atividade, ou o nascimento quando nunca houve uma. */
function horasParado(lead: Lead, agora: number): number {
  const marco = lead.last_activity_at ?? lead.created_at;
  if (!marco) return Number.POSITIVE_INFINITY;
  return (agora - new Date(marco).getTime()) / 3_600_000;
}

export function applyFilters(leads: Lead[], f: LeadFilters): Lead[] {
  const agora = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const search = f.search?.trim().toLowerCase() ?? "";

  return leads.filter((l) => {
    // "Sem responsável" é sem dono NENHUM — lead de dono agente tem dono.
    if (
      f.owner === "unassigned" &&
      (l.owner_user_id !== null || l.owner_agent_id !== null)
    )
      return false;
    if (f.owner && f.owner !== "any" && f.owner !== "unassigned") {
      const agentId = parseAgentOwnerFilter(f.owner);
      if (agentId) {
        if (l.owner_agent_id !== agentId) return false;
      } else if (l.owner_user_id !== f.owner) {
        return false;
      }
    }
    if (f.status && f.status !== "all" && l.status !== f.status) return false;
    if (f.tag && !l.tags.includes(f.tag)) return false;
    if (
      search &&
      !`${l.title} ${l.description ?? ""}`.toLowerCase().includes(search)
    )
      return false;
    if (typeof f.valueCentsMin === "number" && (l.value_cents ?? 0) < f.valueCentsMin)
      return false;
    if (typeof f.valueCentsMax === "number" && (l.value_cents ?? 0) > f.valueCentsMax)
      return false;
    if (f.overdueOnly) {
      if (l.status !== "open") return false;
      if (!l.expected_close_date || l.expected_close_date >= today) return false;
    }
    if (f.paradosOnly && horasParado(l, agora) < HORAS_SEM_RESPOSTA) return false;
    return true;
  });
}
