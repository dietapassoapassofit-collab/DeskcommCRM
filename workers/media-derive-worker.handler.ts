import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { MEDIA_DERIVE_CONSUMER_KEY, deriveMessageMedia } from "@/workers/media-derive-worker";

/**
 * Chave de desligar a derivação de mídia (transcrição de áudio, leitura de
 * imagem e de PDF).
 *
 * Existe porque a derivação depende de crédito na OpenAI e, sem crédito, CADA
 * áudio que chega queima três tentativas com `no credits remaining` antes de
 * morrer — barulho no log e trabalho no barramento para um resultado que não
 * vem. Em 30/09/2026 eram 20 eventos em retentativa ao mesmo tempo.
 *
 * Desligada, a mensagem de áudio continua chegando e aparecendo na conversa; só
 * não ganha o texto derivado. Para religar, tire a variável do `.env` — nada
 * mais precisa mudar, e o evento seguinte já passa.
 */
const DESLIGADA = process.env.MEDIA_DERIVE_OFF === "1";

export const mediaDeriveHandler: EventHandler = {
  key: MEDIA_DERIVE_CONSUMER_KEY,
  events: ["media.derive_requested"],
  handle: DESLIGADA
    ? async (_row: EventRow): Promise<HandlerResult> => ({
        consumer_key: MEDIA_DERIVE_CONSUMER_KEY,
        status: "skipped",
        detail: "derivação de mídia desligada por configuração (MEDIA_DERIVE_OFF)",
      })
    : deriveMessageMedia,
};
