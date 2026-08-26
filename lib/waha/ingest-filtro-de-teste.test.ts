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

afterEach(() => {
  delete process.env.WHATSAPP_TEST_ONLY_PHONE;
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

  it("sem a env var, não filtra nada — o gate é temporário e some sozinho", async () => {
    const { admin, messages } = bancoDeMentira();

    await dispatchWahaEvent(admin as never, SESSION as never, evento(OUTRO.replace("+", ""), false), "req-3");

    expect(messages.length).toBeGreaterThan(0);
  });
});
