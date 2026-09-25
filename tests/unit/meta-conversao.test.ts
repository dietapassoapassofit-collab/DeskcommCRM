/**
 * O evento que vai para o Meta é dinheiro na conta do cliente: se o formato
 * sair errado, a campanha otimiza para o alvo errado e ninguém percebe pela
 * tela. Estes casos travam as três decisões que o módulo toma sozinho —
 * com clique do anúncio, sem clique, e sem ninguém para reconhecer.
 */
import { describe, it, expect } from "vitest";

import {
  credenciaisDaOrg,
  hash,
  montaEvento,
  normalizaTelefone,
  type VendaFechada,
} from "@/lib/ads/meta-conversao";

const CRED = {
  endpoint: "https://exemplo.invalido/v21.0",
  token: "tok",
  datasetId: "ds",
  wabaId: "waba-1",
};

const VENDA: VendaFechada = {
  leadId: "lead-1",
  valorCentavos: 129900,
  moeda: "BRL",
  fechadaEm: new Date("2026-09-25T18:00:00Z"),
  ctwaClid: null,
  telefone: "(81) 99999-0000",
  email: null,
};

describe("montaEvento", () => {
  it("com clique do anúncio, atribui a conversa ao anúncio", () => {
    const e = montaEvento({ ...VENDA, ctwaClid: "clid-abc" }, CRED)!;
    expect(e.action_source).toBe("business_messaging");
    expect(e.messaging_channel).toBe("whatsapp");
    expect(e.user_data.ctwa_clid).toBe("clid-abc");
    expect(e.user_data.whatsapp_business_account_id).toBe("waba-1");
    expect(e.custom_data).toEqual({ currency: "BRL", value: 1299 });
    expect(e.event_id).toBe("lead-1");
  });

  it("sem clique, ainda vai — casando por telefone em hash", () => {
    const e = montaEvento(VENDA, CRED)!;
    expect(e.action_source).toBe("other");
    expect(e.messaging_channel).toBeUndefined();
    expect(e.user_data.ctwa_clid).toBeUndefined();
    // Telefone NUNCA em claro: o que viaja é o sha-256 do número normalizado.
    expect(e.user_data.ph).toBe(hash("5581999990000"));
  });

  it("sem identificador nenhum, não monta evento", () => {
    expect(montaEvento({ ...VENDA, telefone: null, email: null }, CRED)).toBeNull();
  });

  it("sem valor, não carrega custom_data", () => {
    const e = montaEvento({ ...VENDA, valorCentavos: null }, CRED)!;
    expect(e.custom_data).toBeUndefined();
  });
});

describe("normalizaTelefone", () => {
  it("carimba o DDI do Brasil em número local e respeita quem já tem", () => {
    expect(normalizaTelefone("(81) 99999-0000")).toBe("5581999990000");
    expect(normalizaTelefone("+55 81 99999-0000")).toBe("5581999990000");
    expect(normalizaTelefone("123")).toBeNull();
  });
});

describe("credenciaisDaOrg", () => {
  const amb = {
    META_CAPI_ENDPOINT: "https://exemplo.invalido/v21.0/",
    META_CAPI_SPACEPHONE_TOKEN: "tok",
    META_CAPI_SPACEPHONE_DATASET_ID: "ds",
    META_CAPI_SPACEPHONE_WABA_ID: "waba-1",
  };

  it("lê pelo slug da organização e tira a barra do fim", () => {
    expect(credenciaisDaOrg("spacephone", amb)?.endpoint).toBe("https://exemplo.invalido/v21.0");
  });

  it("organização sem credencial fica de fora", () => {
    expect(credenciaisDaOrg("outra-loja", amb)).toBeNull();
  });

  it("endpoint que não é https não vale", () => {
    expect(credenciaisDaOrg("spacephone", { ...amb, META_CAPI_ENDPOINT: "http://x.invalido" })).toBeNull();
  });
});
