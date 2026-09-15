import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Áudio de boas-vindas: sai UMA vez, só no primeiro contato, e chega ao handler do
 * CRM como mídia de áudio — nunca como texto com a transcrição.
 */

const sendMessageHandler = vi.hoisted(() => vi.fn());
vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler }));

const { decidirPrimeiroContato, ehLeadDoAnuncio, enviarAudioDeBoasVindas, lerAudioDeBoasVindas, SEQ_DO_AUDIO } = await import(
  "@/lib/agent-engine/agent/audio-de-boas-vindas"
);
const { sendTurnMessage } = await import("@/lib/agent-engine/edge/crm/send-message");

const ORG = "org-1";
const CONV = "conv-1";
const CONFIG = {
  boas_vindas: {
    audio_storage_path: `${ORG}/_boas-vindas/limpa-nome.ogg`,
    audio_mime: "audio/ogg",
    transcricao: "Olá, minha amiga, tudo bem? Me conta o que mais tem te incomodado.",
  },
};

function cenario(row: { settings: unknown; ja_falamos: boolean; ultima: string | null }) {
  const copy = vi.fn(async () => ({ data: {}, error: null as null | { message: string } }));
  const send = vi.fn(async () => ({ kind: "sent" as const, idempotencyKey: "k", messageId: "m" }));
  const deps = {
    db: { query: vi.fn(async () => ({ rows: [row] })) } as never,
    supabase: { storage: { from: () => ({ copy }) } } as never,
    channel: { send } as never,
    log: { info: vi.fn(), warn: vi.fn() } as never,
  };
  const ids = { tenantId: ORG, leadId: "lead-1", jobId: "job-1", conversationId: CONV };
  return { copy, send, run: () => enviarAudioDeBoasVindas(deps, ids) };
}

describe("enviarAudioDeBoasVindas", () => {
  it("primeiro contato: copia o áudio para a pasta da conversa e envia com a transcrição no corpo", async () => {
    const c = cenario({ settings: CONFIG, ja_falamos: false, ultima: "oi, vi seu anúncio" });

    expect(await c.run()).toBe("enviado");
    expect(c.copy).toHaveBeenCalledWith(CONFIG.boas_vindas.audio_storage_path, `${ORG}/${CONV}/boas-vindas.ogg`);
    expect(c.send).toHaveBeenCalledWith(
      expect.objectContaining({
        seq: SEQ_DO_AUDIO,
        body: CONFIG.boas_vindas.transcricao,
        media: { kind: "audio", storagePath: `${ORG}/${CONV}/boas-vindas.ogg`, mime: "audio/ogg" },
      }),
    );
  });

  it("contato que já recebeu mensagem nossa não recebe o áudio de novo", async () => {
    const c = cenario({ settings: CONFIG, ja_falamos: true, ultima: "oi" });
    expect(await c.run()).toBe("pulado");
    expect(c.send).not.toHaveBeenCalled();
  });

  it("primeira mensagem STOP: não manda apresentação", async () => {
    const c = cenario({ settings: CONFIG, ja_falamos: false, ultima: "PARAR" });
    expect(await c.run()).toBe("pulado");
    expect(c.copy).not.toHaveBeenCalled();
    expect(c.send).not.toHaveBeenCalled();
  });

  it("organização sem configuração: nada acontece", async () => {
    const c = cenario({ settings: { llm: {} }, ja_falamos: false, ultima: "oi" });
    expect(await c.run()).toBe("pulado");
    expect(c.copy).not.toHaveBeenCalled();
  });

  it("falha na cópia não derruba o turno e não envia", async () => {
    const c = cenario({ settings: CONFIG, ja_falamos: false, ultima: "oi" });
    c.copy.mockResolvedValueOnce({ data: {}, error: { message: "bucket fora" } });
    expect(await c.run()).toBe("pulado");
    expect(c.send).not.toHaveBeenCalled();
  });

  it("configuração incompleta (sem transcrição) conta como desligada", () => {
    expect(lerAudioDeBoasVindas({ boas_vindas: { audio_storage_path: "x.ogg", transcricao: " " } })).toBeNull();
  });
});

describe("filtro de lead do anúncio", () => {
  const FRASES = ["Como funciona o processo de limpar o nome?"];

  it("reconhece o texto do anúncio mesmo com caixa, acento e pontuação diferentes", () => {
    expect(ehLeadDoAnuncio("Como funciona o processo de limpar o nome?", FRASES)).toBe(true);
    expect(ehLeadDoAnuncio("oi! como funciona o PROCESSO de limpar o nome", FRASES)).toBe(true);
  });

  it("mensagem de cliente antigo não é lead do anúncio", () => {
    expect(ehLeadDoAnuncio("Como é que você tá, espero que esteja bem", FRASES)).toBe(false);
    expect(ehLeadDoAnuncio(null, FRASES)).toBe(false);
    expect(ehLeadDoAnuncio("", FRASES)).toBe(false);
  });

  function db(row: { settings: unknown; ia_ja_atendeu: boolean; primeira: string | null }) {
    return { query: vi.fn(async () => ({ rows: [row] })) } as never;
  }
  const ids = { tenantId: "org-1", leadId: "lead-1" };
  const SETTINGS = { boas_vindas: { frases_do_anuncio: FRASES } };

  it("primeira mensagem diferente do anúncio → fora_do_anuncio", async () => {
    expect(await decidirPrimeiroContato(db({ settings: SETTINGS, ia_ja_atendeu: false, primeira: "Boa tarde, minha amiga" }), ids)).toBe(
      "fora_do_anuncio",
    );
  });

  it("primeira mensagem é o anúncio → lead_do_anuncio", async () => {
    expect(
      await decidirPrimeiroContato(db({ settings: SETTINGS, ia_ja_atendeu: false, primeira: "Como funciona o processo de limpar o nome?" }), ids),
    ).toBe("lead_do_anuncio");
  });

  it("IA já atendeu o contato → não decide de novo", async () => {
    expect(await decidirPrimeiroContato(db({ settings: SETTINGS, ia_ja_atendeu: true, primeira: "qualquer coisa" }), ids)).toBe(
      "nao_se_aplica",
    );
  });

  it("organização sem frases configuradas → filtro desligado", async () => {
    expect(await decidirPrimeiroContato(db({ settings: { llm: {} }, ia_ja_atendeu: false, primeira: "oi" }), ids)).toBe(
      "nao_se_aplica",
    );
  });
});

describe("sendTurnMessage com mídia", () => {
  beforeEach(() => {
    sendMessageHandler.mockReset();
    sendMessageHandler.mockResolvedValue({ id: "msg-1", status: "sent" });
  });

  it("chega ao handler como áudio do storage, não como texto", async () => {
    const db = { query: vi.fn(async () => ({ rows: [{ id: "ledger-1" }] })) };
    const out = await sendTurnMessage(db as never, { supabase: {} as never }, {
      tenantId: ORG,
      leadId: "lead-1",
      jobId: "job-1",
      seq: 0,
      conversationId: CONV,
      body: "transcrição",
      media: { kind: "audio", storagePath: `${ORG}/${CONV}/boas-vindas.ogg`, mime: "audio/ogg" },
    });

    expect(out.kind).toBe("sent");
    const entrada = sendMessageHandler.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(entrada).toMatchObject({
      type: "audio",
      media_storage_path: `${ORG}/${CONV}/boas-vindas.ogg`,
      media_mime: "audio/ogg",
      body: "transcrição",
    });
  });

  it("texto comum continua saindo como texto", async () => {
    const db = { query: vi.fn(async () => ({ rows: [{ id: "ledger-2" }] })) };
    await sendTurnMessage(db as never, { supabase: {} as never }, {
      tenantId: ORG,
      leadId: "lead-1",
      jobId: "job-2",
      seq: 1,
      conversationId: CONV,
      body: "oi",
    });
    const entrada = sendMessageHandler.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(entrada.type).toBe("text");
    expect(entrada.media_storage_path).toBeUndefined();
  });
});
