import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Material pronto da empresa: sai uma vez por contato, na ordem configurada, com os
 * arquivos dentro da pasta da conversa — e só com os gates que protegem contato e número.
 */

const sendMessageHandler = vi.hoisted(() => vi.fn());
vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler }));

const { GATES_DE_MATERIAL, lerMateriais, prepararMaterial } = await import(
  "@/lib/agent-engine/agent/material-da-empresa"
);
const { sendTurnMessage } = await import("@/lib/agent-engine/edge/crm/send-message");

const ORG = "org-1";
const CONV = "conv-1";
const SETTINGS = {
  materiais: {
    caso_otavio: {
      itens: [
        { kind: "image", path: `${ORG}/_boas-vindas/caso-otavio-1.jpeg`, mime: "image/jpeg" },
        { kind: "image", path: `${ORG}/_boas-vindas/caso-otavio-2.jpeg`, mime: "image/jpeg" },
        { kind: "audio", path: `${ORG}/_boas-vindas/caso-otavio.ogg`, mime: "audio/ogg", transcricao: "Olha, quando o seu Otávio chegou..." },
      ],
    },
  },
};

function cenario(opts: { settings?: unknown; jaEnviado?: boolean } = {}) {
  const copy = vi.fn(async () => ({ data: {}, error: null as null | { message: string } }));
  const query = vi.fn(async (sql: string) =>
    sql.includes("from organizations")
      ? { rows: [{ settings: opts.settings ?? SETTINGS }] }
      : { rows: [{ ja: opts.jaEnviado ?? false }] },
  );
  const deps = { db: { query } as never, supabase: { storage: { from: () => ({ copy }) } } as never };
  const ids = { tenantId: ORG, leadId: "lead-1", conversationId: CONV, materialId: "caso_otavio" };
  return { copy, run: (materialId = "caso_otavio") => prepararMaterial(deps, { ...ids, materialId }) };
}

describe("prepararMaterial", () => {
  it("copia cada item para a conversa, na ordem, imagem sem corpo e áudio com a transcrição", async () => {
    const c = cenario();
    const out = await c.run();

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.envios.map((e) => e.media.storagePath)).toEqual([
      `${ORG}/${CONV}/material-caso_otavio-1.jpeg`,
      `${ORG}/${CONV}/material-caso_otavio-2.jpeg`,
      `${ORG}/${CONV}/material-caso_otavio-3.ogg`,
    ]);
    expect(out.envios.map((e) => e.body)).toEqual(["", "", "Olha, quando o seu Otávio chegou..."]);
    expect(out.envios.map((e) => e.media.kind)).toEqual(["image", "image", "audio"]);
    expect(c.copy).toHaveBeenCalledTimes(3);
  });

  it("já enviado para este contato: recusa e não copia nada", async () => {
    const c = cenario({ jaEnviado: true });
    const out = await c.run();
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("material_ja_enviado");
    expect(c.copy).not.toHaveBeenCalled();
  });

  it("id desconhecido: recusa dizendo quais existem", async () => {
    const out = await cenario().run("caso_joao");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("material_desconhecido");
    expect(out.error.message).toContain("caso_otavio");
  });

  it("falha de cópia: recusa em vez de mandar pela metade", async () => {
    const c = cenario();
    c.copy.mockResolvedValueOnce({ data: {}, error: null }).mockResolvedValueOnce({ data: {}, error: { message: "bucket fora" } });
    const out = await c.run();
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("material_indisponivel");
  });
});

describe("lerMateriais", () => {
  it("material com qualquer item inválido fica de fora inteiro", () => {
    const m = lerMateriais({
      materiais: {
        bom: { itens: [{ kind: "image", path: "a.jpg", mime: "image/jpeg" }] },
        quebrado: { itens: [{ kind: "image", path: "a.jpg", mime: "image/jpeg" }, { kind: "video", path: "b.mp4", mime: "video/mp4" }] },
      },
    });
    expect(Object.keys(m)).toEqual(["bom"]);
  });
});

describe("GATES_DE_MATERIAL", () => {
  it("são exatamente stop, LGPD e pacing", () => {
    expect(GATES_DE_MATERIAL.map((g) => g.name).sort()).toEqual(["lgpd", "pacing", "stop"]);
  });
});

describe("sendTurnMessage com imagem", () => {
  beforeEach(() => {
    sendMessageHandler.mockReset();
    sendMessageHandler.mockResolvedValue({ id: "msg-1", status: "sent" });
  });

  it("chega ao handler como imagem do storage, sem legenda", async () => {
    const db = { query: vi.fn(async () => ({ rows: [{ id: "ledger-1" }] })) };
    await sendTurnMessage(db as never, { supabase: {} as never }, {
      tenantId: ORG,
      leadId: "lead-1",
      jobId: "job-1",
      seq: 1,
      conversationId: CONV,
      body: "",
      media: { kind: "image", storagePath: `${ORG}/${CONV}/material-caso_otavio-1.jpeg`, mime: "image/jpeg" },
    });
    expect(sendMessageHandler.mock.calls[0]?.[2]).toMatchObject({
      type: "image",
      media_storage_path: `${ORG}/${CONV}/material-caso_otavio-1.jpeg`,
      media_mime: "image/jpeg",
      body: "",
    });
  });
});
