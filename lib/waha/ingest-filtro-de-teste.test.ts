import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { dispatchWahaEvent, type WahaEnvelope, type WahaPayload } from "@/lib/waha/ingest";

/**
 * O FILTRO DE TESTE PRECISA VALER NOS DOIS SENTIDOS.
 *
 * Enquanto ele guardava só `fromMe=false`, tudo que o OUTRO bot pareado no
 * mesmo chip enviava entrava como `fromMe=true` e virava mensagem da conversa.
 * Medido na instalação: 18 das 20 mensagens da janela de contexto do agente
 * eram relatório de Meta Ads e aviso de deploy de um bot que não é este.
 *
 * O caso `fromMe` é o que regride: o inbound sempre esteve coberto.
 */

const NUMERO_DE_TESTE = "+5581999999999";
const OUTRO = "+5581888888888";

interface Duplo {
  admin: unknown;
  messages: Array<Record<string, unknown>>;
}

function bancoDeMentira(): Duplo {
  const messages: Array<Record<string, unknown>> = [];
  const consulta = () => {
    const q = {
      eq: () => q,
      in: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return q;
  };
  const admin = {
    from: () => ({
      select: () => consulta(),
      insert: (linha: Record<string, unknown>) => ({
        select: () => ({
          maybeSingle: async () => {
            messages.push(linha);
            return { data: { id: `msg-${messages.length}` }, error: null };
          },
        }),
      }),
    }),
    rpc: async (fn: string) => {
      if (fn === "fn_upsert_wa_contact") return { data: "contato-1", error: null };
      if (fn === "fn_upsert_wa_conversation") return { data: "conversa-1", error: null };
      return { data: null, error: null };
    },
  };
  return { admin, messages };
}

const SESSION = { id: "sessao-1", organization_id: "org-1" };

function evento(chatDigits: string, fromMe: boolean): WahaEnvelope {
  const chat = `${chatDigits}@c.us`;
  const payload: WahaPayload = {
    id: `${fromMe}_${chat}_ABC`,
    timestamp: 1,
    body: "mensagem qualquer",
    fromMe,
    ...(fromMe ? { to: chat, from: "5581000000000@c.us" } : { from: chat }),
  } as WahaPayload;
  return { event: "message", session: "sessao-waha", payload } as WahaEnvelope;
}

/**
 * O formato REAL da engine NOWEB: o chat é uma identidade opaca `@lid` e o
 * telefone só existe em `remoteJidAlt`. Todo contato desta instalação chega
 * assim — inclusive o de teste.
 */
function eventoLid(lid: string, telefoneAlt: string | null): WahaEnvelope {
  const chat = `${lid}@lid`;
  const payload = {
    id: `false_${chat}_ABC`,
    timestamp: 1,
    body: "mensagem qualquer",
    fromMe: false,
    from: chat,
    ...(telefoneAlt
      ? { _data: { key: { remoteJidAlt: `${telefoneAlt.replace("+", "")}@s.whatsapp.net` } } }
      : {}),
  } as unknown as WahaPayload;
  return { event: "message", session: "sessao-waha", payload } as WahaEnvelope;
}

afterEach(() => {
  delete process.env.WHATSAPP_TEST_ONLY_PHONE;
  delete process.env.WHATSAPP_TEST_ONLY_ORG_ID;
});

describe("filtro WHATSAPP_TEST_ONLY_PHONE", () => {
  it("descarta fromMe de chat que não é o de teste (o bot vizinho no mesmo chip)", async () => {
    process.env.WHATSAPP_TEST_ONLY_PHONE = NUMERO_DE_TESTE;
    const { admin, messages } = bancoDeMentira();

    await dispatchWahaEvent(admin as never, SESSION as never, evento(OUTRO.replace("+", ""), true), "req-1");

    expect(messages).toHaveLength(0);
  });

  it("descarta inbound de chat que não é o de teste", async () => {
    process.env.WHATSAPP_TEST_ONLY_PHONE = NUMERO_DE_TESTE;
    const { admin, messages } = bancoDeMentira();

    await dispatchWahaEvent(admin as never, SESSION as never, evento(OUTRO.replace("+", ""), false), "req-2");

    expect(messages).toHaveLength(0);
  });

  it("descarta chat @lid de OUTRA pessoa — o formato que a engine NOWEB usa de verdade", async () => {
    // O caso que passou batido: escrito como denylist sobre `kind === "phone"`,
    // o gate nunca disparava aqui, e o agente da loja respondeu a um colega.
    process.env.WHATSAPP_TEST_ONLY_PHONE = NUMERO_DE_TESTE;
    const { admin, messages } = bancoDeMentira();

    await dispatchWahaEvent(admin as never, SESSION as never, eventoLid("79388209111041", OUTRO), "req-lid-1");

    expect(messages).toHaveLength(0);
  });

  it("deixa passar o chat @lid cujo remoteJidAlt É o número de teste", async () => {
    // O contrapeso: allowlist que barra todo mundo cala também quem devia
    // passar, e o teste inteiro deixaria de acontecer sem ninguém entender.
    process.env.WHATSAPP_TEST_ONLY_PHONE = NUMERO_DE_TESTE;
    const { admin, messages } = bancoDeMentira();

    await dispatchWahaEvent(
      admin as never,
      SESSION as never,
      eventoLid("33454137847869", NUMERO_DE_TESTE),
      "req-lid-2",
    );

    expect(messages.length).toBeGreaterThan(0);
  });

  it("descarta chat @lid SEM telefone no payload — não dá para saber quem é", async () => {
    process.env.WHATSAPP_TEST_ONLY_PHONE = NUMERO_DE_TESTE;
    const { admin, messages } = bancoDeMentira();

    await dispatchWahaEvent(admin as never, SESSION as never, eventoLid("99999999999999", null), "req-lid-3");

    expect(messages).toHaveLength(0);
  });

  it("sem a env var, não filtra nada — o gate é temporário e some sozinho", async () => {
    const { admin, messages } = bancoDeMentira();

    await dispatchWahaEvent(admin as never, SESSION as never, evento(OUTRO.replace("+", ""), false), "req-3");

    expect(messages.length).toBeGreaterThan(0);
  });

  it("com WHATSAPP_TEST_ONLY_ORG_ID de OUTRA org, não filtra — a org do número próprio recebe tudo", async () => {
    process.env.WHATSAPP_TEST_ONLY_PHONE = NUMERO_DE_TESTE;
    process.env.WHATSAPP_TEST_ONLY_ORG_ID = "org-galega";
    const { admin, messages } = bancoDeMentira();

    await dispatchWahaEvent(admin as never, SESSION as never, eventoLid("79388209111041", OUTRO), "req-org-1");

    expect(messages.length).toBeGreaterThan(0);
  });

  it("com WHATSAPP_TEST_ONLY_ORG_ID da PRÓPRIA org, continua filtrando nos dois sentidos", async () => {
    process.env.WHATSAPP_TEST_ONLY_PHONE = NUMERO_DE_TESTE;
    process.env.WHATSAPP_TEST_ONLY_ORG_ID = SESSION.organization_id;
    const { admin, messages } = bancoDeMentira();

    await dispatchWahaEvent(admin as never, SESSION as never, eventoLid("79388209111041", OUTRO), "req-org-2");
    await dispatchWahaEvent(admin as never, SESSION as never, evento(OUTRO.replace("+", ""), true), "req-org-3");

    expect(messages).toHaveLength(0);
  });
});
