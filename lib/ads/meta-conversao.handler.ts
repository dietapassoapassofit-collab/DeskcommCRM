/**
 * Liga `lib/ads/meta-conversao.ts` no dispatcher do `event_log`, ouvindo a
 * mudança de etapa do negócio.
 *
 * Por que aqui e não dentro de `encerraDemanda`: o negócio anda no funil por
 * caminhos diferentes — botão, card arrastado, IA, API. Todos passam pelo mesmo
 * `lead.stage_changed`, e o dispatcher já garante uma entrega por handler
 * (`consumed_by`), que é exatamente a idempotência que um evento de conversão
 * precisa. Pendurar o envio em cada caminho daria envio duplicado num e envio
 * nenhum no outro.
 *
 * DOIS FATOS SOBEM, não um. Venda são oito por mês; sozinha, ela não ensina
 * nada a quem otimiza por volume. O lead qualificado — o cliente que o vendedor
 * tirou da caixa de entrada e classificou numa coluna de produto — são setenta
 * por mês, e é o sinal que separa "respondeu a mensagem" de "quer comprar".
 */
import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  credenciaisDaOrg,
  enviaConversao,
  montaEvento,
  type FatoDoFunil,
  type TipoDeFato,
} from "@/lib/ads/meta-conversao";

export const META_CONVERSAO_HANDLER_KEY = "meta-conversao.v1";

const texto = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

const pulado = (detail: string): HandlerResult => ({
  consumer_key: META_CONVERSAO_HANDLER_KEY,
  status: "skipped",
  detail,
});

interface Etapa {
  id: string;
  position: number;
  is_won: boolean;
  is_lost: boolean;
  is_archived: boolean;
}

/**
 * O que a chegada nesta etapa significa para o Meta.
 *
 * A regra não tem lista de nomes de etapa de propósito: nome muda, o cliente
 * cria coluna nova, e uma lista desatualizada silenciaria o envio sem ninguém
 * perceber. O que vale é a POSIÇÃO — a primeira etapa é a caixa de entrada, por
 * onde todo mundo passa, então chegar nela não qualifica ninguém. Qualificar é
 * SAIR dela: alguém leu a conversa e decidiu que aquilo é um lead de verdade.
 */
export function fatoDaEtapa(
  etapas: Etapa[],
  destinoId: string,
  origemId: string | null,
): TipoDeFato | null {
  const destino = etapas.find((e) => e.id === destinoId);
  if (!destino) return null;
  if (destino.is_won) return "venda";
  if (destino.is_lost) return null;

  const vivas = etapas.filter((e) => !e.is_archived && !e.is_won && !e.is_lost);
  const entrada = vivas.reduce<Etapa | null>(
    (menor, e) => (menor === null || e.position < menor.position ? e : menor),
    null,
  );
  if (!entrada || destino.id === entrada.id) return null;
  // Só a saída da caixa de entrada vale. Andar entre colunas de produto depois
  // é o vendedor corrigindo a classificação, não um lead novo.
  return origemId === entrada.id ? "lead" : null;
}

export const metaConversaoHandler: EventHandler = {
  key: META_CONVERSAO_HANDLER_KEY,
  events: ["lead.stage_changed"],

  async handle(row: EventRow): Promise<HandlerResult> {
    const leadId = texto(row.entity_id);
    const etapaDestino = texto(row.payload.to_stage_id);
    if (!leadId || !etapaDestino) return pulado("evento sem negócio ou sem etapa");

    try {
      const admin = createAdminClient();

      const { data: destino } = await admin
        .from("crm_stages")
        .select("id, pipeline_id")
        .eq("id", etapaDestino)
        .eq("organization_id", row.organization_id)
        .maybeSingle();
      if (!destino) return pulado("etapa não encontrada");

      const { data: etapas } = await admin
        .from("crm_stages")
        .select("id, position, is_won, is_lost, is_archived")
        .eq("pipeline_id", destino.pipeline_id)
        .eq("organization_id", row.organization_id);

      const tipo = fatoDaEtapa(
        (etapas ?? []) as Etapa[],
        etapaDestino,
        texto(row.payload.from_stage_id),
      );
      if (!tipo) return pulado("mudança de etapa que não vira conversão");

      const { data: org } = await admin
        .from("organizations")
        .select("slug")
        .eq("id", row.organization_id)
        .maybeSingle();
      const cred = org?.slug ? credenciaisDaOrg(org.slug) : null;
      if (!cred) return pulado("organização sem credencial de conversão");

      const { data: lead } = await admin
        .from("crm_leads")
        .select("id, value_cents, currency, closed_at, contact_id")
        .eq("id", leadId)
        .eq("organization_id", row.organization_id)
        .maybeSingle();
      if (!lead) return pulado("negócio não encontrado");

      // Venda sem valor vai assim mesmo, SEM `custom_data`: o dataset aceita
      // (verificado contra a API), e a conversão perdida custa mais à campanha
      // do que o faturamento em branco custa ao relatório. O diálogo do funil
      // pede o valor na hora de ganhar — este caminho é a exceção.

      let ctwaClid: string | null = null;
      let telefone: string | null = null;
      let email: string | null = null;
      if (lead.contact_id) {
        const { data: contato } = await admin
          .from("contacts")
          .select("phone_number, email, source_metadata, is_anonymized")
          .eq("id", lead.contact_id)
          .maybeSingle();
        // Contato anonimizado por pedido de LGPD não volta para o Meta nem em hash.
        if (contato?.is_anonymized) return pulado("contato anonimizado (LGPD)");
        const meta = (contato?.source_metadata ?? {}) as Record<string, unknown>;
        const bruto = (meta.ad_raw ?? {}) as Record<string, unknown>;
        ctwaClid = texto(bruto.ctwaClid) ?? texto(meta.ctwa_clid);
        telefone = texto(contato?.phone_number ?? null);
        email = texto(contato?.email ?? null);
      }

      const fato: FatoDoFunil = {
        tipo,
        leadId: lead.id,
        valorCentavos: lead.value_cents,
        moeda: lead.currency,
        // Venda tem hora própria (`closed_at`); lead qualificado acontece no
        // instante em que a etapa mudou, que é a hora do evento.
        aconteceuEm: new Date(
          (tipo === "venda" ? lead.closed_at : null) ?? row.created_at ?? Date.now(),
        ),
        ctwaClid,
        telefone,
        email,
      };

      const evento = montaEvento(fato, cred);
      if (!evento) return pulado("sem identificador para o Meta reconhecer");

      let usado = evento;
      let envio = await enviaConversao(evento, cred);

      // O `ctwa_clid` só é aceito por dataset com conta do WhatsApp vinculada.
      // Enquanto essa ligação não existe, o Meta recusa o evento inteiro — e
      // recusar o fato por causa da forma da atribuição seria perder o dado
      // todo. Aqui ele vai pelo telefone, e no dia em que a ligação existir a
      // atribuição forte passa a valer sozinha, sem deploy.
      if (!envio.ok && !envio.retentavel && evento.user_data.ctwa_clid) {
        const semClique = montaEvento({ ...fato, ctwaClid: null }, cred);
        if (semClique) {
          const recusa = envio.detalhe;
          usado = semClique;
          envio = await enviaConversao(semClique, cred);
          if (envio.ok) {
            return {
              consumer_key: META_CONVERSAO_HANDLER_KEY,
              status: "ok",
              detail: `${usado.event_name} fallback telefone (clique recusado: ${recusa.slice(0, 100)})`,
            };
          }
        }
      }

      if (envio.ok) {
        return {
          consumer_key: META_CONVERSAO_HANDLER_KEY,
          status: "ok",
          detail: `${usado.event_name} ${usado.action_source} valor=${usado.custom_data?.value ?? "-"} ${envio.detalhe}`,
        };
      }
      return {
        consumer_key: META_CONVERSAO_HANDLER_KEY,
        status: envio.retentavel ? "retry" : "error",
        detail: envio.detalhe,
      };
    } catch (err) {
      return {
        consumer_key: META_CONVERSAO_HANDLER_KEY,
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
