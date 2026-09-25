/**
 * Liga `lib/ads/meta-conversao.ts` no dispatcher do `event_log`, ouvindo a
 * mudança de etapa do negócio.
 *
 * Por que aqui e não dentro de `encerraDemanda`: o negócio vira ganho por
 * caminhos diferentes — botão de encerrar, card arrastado para a etapa de
 * ganho, a IA, a API. Todos passam pelo mesmo `lead.stage_changed`, e o
 * dispatcher já garante uma entrega por handler (`consumed_by`), que é
 * exatamente a idempotência que um evento de compra precisa. Pendurar o envio
 * em cada caminho daria envio duplicado num e envio nenhum no outro.
 */
import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  credenciaisDaOrg,
  enviaConversao,
  montaEvento,
  type VendaFechada,
} from "@/lib/ads/meta-conversao";

export const META_CONVERSAO_HANDLER_KEY = "meta-conversao.v1";

const texto = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

const pulado = (detail: string): HandlerResult => ({
  consumer_key: META_CONVERSAO_HANDLER_KEY,
  status: "skipped",
  detail,
});

export const metaConversaoHandler: EventHandler = {
  key: META_CONVERSAO_HANDLER_KEY,
  events: ["lead.stage_changed"],

  async handle(row: EventRow): Promise<HandlerResult> {
    const leadId = texto(row.entity_id);
    const etapaDestino = texto(row.payload.to_stage_id);
    if (!leadId || !etapaDestino) return pulado("evento sem negócio ou sem etapa");

    try {
      const admin = createAdminClient();

      const { data: etapa } = await admin
        .from("crm_stages")
        .select("is_won")
        .eq("id", etapaDestino)
        .eq("organization_id", row.organization_id)
        .maybeSingle();
      if (!etapa?.is_won) return pulado("etapa não é de ganho");

      const { data: org } = await admin
        .from("organizations")
        .select("slug")
        .eq("id", row.organization_id)
        .maybeSingle();
      const cred = org?.slug ? credenciaisDaOrg(org.slug) : null;
      if (!cred) return pulado("organização sem credencial de conversão");

      const { data: lead } = await admin
        .from("crm_leads")
        .select("id, value_cents, currency, closed_at, contact_id, updated_at")
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

      const venda: VendaFechada = {
        leadId: lead.id,
        valorCentavos: lead.value_cents,
        moeda: lead.currency,
        fechadaEm: new Date(lead.closed_at ?? row.created_at ?? Date.now()),
        ctwaClid,
        telefone,
        email,
      };

      const evento = montaEvento(venda, cred);
      if (!evento) return pulado("sem identificador para o Meta reconhecer");

      let usado = evento;
      let envio = await enviaConversao(evento, cred);

      // O `ctwa_clid` só é aceito por dataset com conta do WhatsApp vinculada.
      // Enquanto essa ligação não existe, o Meta recusa o evento inteiro — e
      // recusar a venda por causa da forma da atribuição seria perder o dado
      // todo. Aqui a venda vai pelo telefone, e no dia em que a ligação existir
      // a atribuição forte passa a valer sozinha, sem deploy.
      if (!envio.ok && !envio.retentavel && evento.user_data.ctwa_clid) {
        const semClique = montaEvento({ ...venda, ctwaClid: null }, cred);
        if (semClique) {
          const recusa = envio.detalhe;
          usado = semClique;
          envio = await enviaConversao(semClique, cred);
          if (envio.ok) {
            return {
              consumer_key: META_CONVERSAO_HANDLER_KEY,
              status: "ok",
              detail: `fallback telefone (clique recusado: ${recusa.slice(0, 120)})`,
            };
          }
        }
      }

      if (envio.ok) {
        return {
          consumer_key: META_CONVERSAO_HANDLER_KEY,
          status: "ok",
          detail: `${usado.action_source} valor=${usado.custom_data?.value ?? "-"} ${envio.detalhe}`,
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
