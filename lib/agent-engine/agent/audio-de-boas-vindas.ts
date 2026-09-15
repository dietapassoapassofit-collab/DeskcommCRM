/**
 * Áudio de boas-vindas no primeiro contato.
 *
 * Tem empresa que recebe TODO lead novo com o mesmo áudio, gravado pela dona. A
 * organização configura em `organizations.settings.boas_vindas`:
 *   { audio_storage_path, audio_mime, transcricao }
 * e, no primeiro turno de um contato com quem NUNCA falamos, o áudio sai antes de o
 * modelo rodar.
 *
 * ⚠️ ANTES DE LER O HISTÓRICO, não só antes do modelo. A transcrição vai no `body` da
 * mensagem; é assim que o modelo enxerga o que o áudio já disse e não repete a
 * pergunta que ele fez. Chamado depois do `getLeadContext`, o turno responderia sem
 * saber que o áudio saiu.
 *
 * ⚠️ NUNCA DERRUBA O TURNO. Sem configuração, contato que já recebeu mensagem nossa,
 * pedido de humano/STOP na primeira mensagem, ou falha de cópia/envio: o turno segue
 * exatamente como seguia antes desta função existir.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { ChannelAdapter } from '../channel-adapter';
import type { Logger } from '../obs/logger';
import type { Queryable } from '../queue/queue';
import { detectAmbiguousOptOut, detectHumanHandoffRequest } from './human-handoff';

const BUCKET = 'whatsapp-media';

/** As mensagens do modelo começam em 1 (`seq += 1` antes de cada envio): o 0 é livre. */
export const SEQ_DO_AUDIO = 0;

/**
 * O sink só aceita mídia de dentro da pasta da conversa (`<org>/<conversa>/`): copia o
 * arquivo da organização para lá. "Já existe" é replay, não erro. Devolve a mensagem de
 * erro, ou null quando o arquivo está no destino.
 */
export async function copiarParaConversa(
  supabase: SupabaseClient,
  origem: string,
  destino: string,
): Promise<string | null> {
  const { error } = await supabase.storage.from(BUCKET).copy(origem, destino);
  return error && !/exist/i.test(error.message) ? error.message : null;
}

export interface AudioDeBoasVindas {
  storagePath: string;
  mime: string;
  transcricao: string;
}

/** Lê a configuração de `organizations.settings`; incompleta = desligado. */
export function lerAudioDeBoasVindas(settings: unknown): AudioDeBoasVindas | null {
  const bv = (settings as { boas_vindas?: Record<string, unknown> } | null)?.boas_vindas;
  if (!bv || typeof bv.audio_storage_path !== 'string' || typeof bv.transcricao !== 'string') return null;
  const transcricao = bv.transcricao.trim();
  if (!bv.audio_storage_path || !transcricao) return null;
  return {
    storagePath: bv.audio_storage_path,
    mime: typeof bv.audio_mime === 'string' && bv.audio_mime ? bv.audio_mime : 'audio/ogg',
    transcricao,
  };
}

/**
 * Quem a IA atende: quando a organização configura `boas_vindas.frases_do_anuncio`,
 * só o contato cuja PRIMEIRA mensagem traz o texto do anúncio é lead para a IA.
 *
 * ⚠️ POR QUE EXISTE: o número conectado costuma ser o WhatsApp de uso diário da dona.
 * O CRM não enxerga as conversas anteriores à conexão, então cliente em andamento
 * chegava como "contato novo" e recebia apresentação de desconhecido e qualificação
 * da IA (medido 15/09/2026: cliente que já estava em processo).
 */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function lerFrasesDoAnuncio(settings: unknown): string[] {
  const f = (settings as { boas_vindas?: { frases_do_anuncio?: unknown } } | null)?.boas_vindas?.frases_do_anuncio;
  return Array.isArray(f) ? f.filter((x): x is string => typeof x === 'string' && normalizar(x) !== '') : [];
}

export function ehLeadDoAnuncio(primeiraMensagem: string | null, frases: string[]): boolean {
  const texto = normalizar(primeiraMensagem ?? '');
  return texto !== '' && frases.some((frase) => texto.includes(normalizar(frase)));
}

export type PrimeiroContato = 'nao_se_aplica' | 'lead_do_anuncio' | 'fora_do_anuncio';

/**
 * Decide UMA vez por contato, enquanto a IA ainda não mandou nada para ele. Mensagem
 * que a dona mandou do próprio celular não conta como "a IA já atendeu" — por isso o
 * filtro é `sent_via = 'ai'`, não qualquer outbound.
 */
export async function decidirPrimeiroContato(
  db: Queryable,
  ids: { tenantId: string; leadId: string },
): Promise<PrimeiroContato> {
  const { rows } = await db.query<{ settings: unknown; ia_ja_atendeu: boolean; primeira: string | null }>(
    `select o.settings,
            exists (
              select 1 from messages m
              where m.organization_id = o.id and m.contact_id = $2
                and m.direction = 'outbound' and m.sent_via = 'ai'
            ) as ia_ja_atendeu,
            (
              select m.body from messages m
              where m.organization_id = o.id and m.contact_id = $2 and m.direction = 'inbound'
              order by m.sent_at asc, m.id asc
              limit 1
            ) as primeira
       from organizations o
      where o.id = $1`,
    [ids.tenantId, ids.leadId],
  );
  const row = rows[0];
  const frases = lerFrasesDoAnuncio(row?.settings);
  if (!row || frases.length === 0 || row.ia_ja_atendeu) return 'nao_se_aplica';
  return ehLeadDoAnuncio(row.primeira, frases) ? 'lead_do_anuncio' : 'fora_do_anuncio';
}

export async function enviarAudioDeBoasVindas(
  deps: { db: Queryable; supabase: SupabaseClient; channel: ChannelAdapter; log: Logger },
  ids: { tenantId: string; leadId: string; jobId: string; conversationId: string },
): Promise<'enviado' | 'pulado'> {
  const { rows } = await deps.db.query<{ settings: unknown; ja_falamos: boolean; ultima: string | null }>(
    `select o.settings,
            exists (
              select 1 from messages m
              where m.organization_id = o.id and m.contact_id = $2 and m.direction = 'outbound'
            ) as ja_falamos,
            (
              select m.body from messages m
              where m.organization_id = o.id and m.conversation_id = $3 and m.direction = 'inbound'
              order by m.sent_at desc, m.id desc
              limit 1
            ) as ultima
       from organizations o
      where o.id = $1`,
    [ids.tenantId, ids.leadId, ids.conversationId],
  );
  const row = rows[0];
  const audio = lerAudioDeBoasVindas(row?.settings);
  if (!row || !audio) return 'pulado';

  // Replay de job: se o áudio já saiu, existe outbound — não manda de novo. Se o envio
  // anterior ficou pendurado sem linha em `messages`, o (jobId, seq) do ledger dedupa.
  if (row.ja_falamos) return 'pulado';

  // As travas determinísticas do turno rodam DEPOIS desta função (precisam do histórico).
  // Quem chega pedindo humano ou STOP não recebe áudio de apresentação.
  const ultima = row.ultima ?? '';
  if (detectHumanHandoffRequest(ultima) || detectAmbiguousOptOut(ultima)) return 'pulado';

  const ext = /\.[a-z0-9]+$/i.exec(audio.storagePath)?.[0] ?? '';
  const destino = `${ids.tenantId}/${ids.conversationId}/boas-vindas${ext}`;
  const erroDaCopia = await copiarParaConversa(deps.supabase, audio.storagePath, destino);
  if (erroDaCopia !== null) {
    deps.log.warn('áudio de boas-vindas não copiado — turno segue sem ele', { error: erroDaCopia.slice(0, 120) });
    return 'pulado';
  }

  // ponytail: o áudio não passa pela cadeia before-send (cap diário/warm-up). É 1 mensagem
  // por contato novo, dentro da janela anti-ban (o turno já foi adiado se fora dela) e o
  // sink recusa contato bloqueado. Se o volume de lead novo apertar o cap, passar pela cadeia.
  const envio = await deps.channel.send({
    tenantId: ids.tenantId,
    leadId: ids.leadId,
    jobId: ids.jobId,
    seq: SEQ_DO_AUDIO,
    conversationId: ids.conversationId,
    body: audio.transcricao,
    media: { kind: 'audio', storagePath: destino, mime: audio.mime },
  });
  if (envio.kind === 'sent' || envio.kind === 'already_sent' || envio.kind === 'queued') {
    deps.log.info('áudio de boas-vindas enviado no primeiro contato', { outcome: envio.kind });
    return 'enviado';
  }
  deps.log.warn('áudio de boas-vindas não saiu — turno segue sem ele', { outcome: envio.kind });
  return 'pulado';
}
