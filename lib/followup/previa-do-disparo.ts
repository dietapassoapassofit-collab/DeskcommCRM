/**
 * Quem do lote PODE receber o disparo — decidido antes de inscrever ninguém.
 *
 * ═══ POR QUE EXISTE ═══
 *
 * O disparo em massa inscrevia todo mundo e descobria depois quem não podia
 * receber. Medido em 14 dias na SpacePhone: 67 envios barrados já dentro do
 * motor — 36 por mensagem repetida e 31 por Instagram fora das 24h. Os 31 do
 * Instagram eram desperdício puro: ocupavam vaga no lote, consumiam os 3
 * minutos de espaçamento de cada um e morriam no fim da fila.
 *
 * Aqui ficam só os motivos que dá para saber ANTES. Mensagem repetida depende
 * do que o número mandou nos minutos seguintes — essa continua sendo decidida
 * na hora do envio, e nenhuma prévia honesta pode prometer o contrário.
 */

/** Janela em que o Instagram aceita mensagem de automação. */
export const JANELA_INSTAGRAM_MS = 24 * 60 * 60 * 1000;

export type MotivoDeFora =
  | "contato_nao_encontrado"
  | "contato_bloqueado"
  | "contato_anonimizado"
  | "ja_em_follow_up"
  | "sem_conversa"
  | "instagram_fora_das_24h";

export interface ContatoDaPrevia {
  id: string;
  is_blocked?: boolean | null;
  is_anonymized?: boolean | null;
  wa_identity?: string | null;
}

export interface ConversaDaPrevia {
  contact_id: string;
  last_inbound_at: string | null;
}

export interface Previa {
  aptos: string[];
  fora: Array<{ contact_id: string; motivo: MotivoDeFora }>;
  resumo: Partial<Record<MotivoDeFora, number>>;
}

/** O contato do Instagram entra com a identidade `lid:ig.<id>` (ver nascimento-do-lead). */
const ehInstagram = (c: ContatoDaPrevia) => Boolean(c.wa_identity?.startsWith("lid:ig."));

export function montaPrevia(
  pedidos: readonly string[],
  contatos: readonly ContatoDaPrevia[],
  jaInscritos: ReadonlySet<string>,
  conversas: readonly ConversaDaPrevia[],
  agora: Date,
): Previa {
  const porId = new Map(contatos.map((c) => [c.id, c]));
  // A conversa mais recente de cada contato manda: é nela que a mensagem sai.
  const entradaPorContato = new Map<string, string | null>();
  for (const c of conversas) {
    const atual = entradaPorContato.get(c.contact_id);
    if (atual === undefined || (c.last_inbound_at ?? "") > (atual ?? "")) {
      entradaPorContato.set(c.contact_id, c.last_inbound_at);
    }
  }

  const aptos: string[] = [];
  const fora: Previa["fora"] = [];
  const resumo: Previa["resumo"] = {};

  const barra = (contact_id: string, motivo: MotivoDeFora) => {
    fora.push({ contact_id, motivo });
    resumo[motivo] = (resumo[motivo] ?? 0) + 1;
  };

  for (const id of new Set(pedidos)) {
    const contato = porId.get(id);
    if (!contato) {
      barra(id, "contato_nao_encontrado");
      continue;
    }
    if (contato.is_blocked) {
      barra(id, "contato_bloqueado");
      continue;
    }
    if (contato.is_anonymized) {
      barra(id, "contato_anonimizado");
      continue;
    }
    if (jaInscritos.has(id)) {
      barra(id, "ja_em_follow_up");
      continue;
    }
    if (!entradaPorContato.has(id)) {
      barra(id, "sem_conversa");
      continue;
    }
    if (ehInstagram(contato)) {
      const ultima = entradaPorContato.get(id);
      const dentro =
        ultima !== null && ultima !== undefined &&
        agora.getTime() - new Date(ultima).getTime() < JANELA_INSTAGRAM_MS;
      if (!dentro) {
        barra(id, "instagram_fora_das_24h");
        continue;
      }
    }
    aptos.push(id);
  }

  return { aptos, fora, resumo };
}

/** O texto que o lojista lê na tela. Um motivo por linha, na ordem do que mais pesa. */
export const TEXTO_DO_MOTIVO: Record<MotivoDeFora, string> = {
  ja_em_follow_up: "já estão em outro follow-up",
  instagram_fora_das_24h: "do Instagram sem falar há mais de 24h",
  contato_bloqueado: "bloquearam ou pediram para sair",
  sem_conversa: "não têm conversa aberta",
  contato_anonimizado: "foram anonimizados (LGPD)",
  contato_nao_encontrado: "não foram encontrados",
};
