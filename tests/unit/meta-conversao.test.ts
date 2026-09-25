/**
 * O evento que vai para o Meta é dinheiro na conta do cliente: se o formato
 * sair errado, a campanha otimiza para o alvo errado e ninguém percebe pela
 * tela. Estes casos travam as decisões que o módulo toma sozinho — com clique
 * do anúncio, sem clique, sem ninguém para reconhecer — e a regra que decide
 * qual mudança de etapa vira conversão.
 */
import { describe, it, expect } from "vitest";

import {
  credenciaisDaOrg,
  hash,
  montaEvento,
  normalizaTelefone,
  type FatoDoFunil,
} from "@/lib/ads/meta-conversao";
import { fatoDaEtapa } from "@/lib/ads/meta-conversao.handler";

const CRED = {
  endpoint: "https://exemplo.invalido/v21.0",
  token: "tok",
  datasetId: "ds",
  wabaId: "waba-1",
};

const VENDA: FatoDoFunil = {
  tipo: "venda",
  leadId: "lead-1",
  valorCentavos: 129900,
  moeda: "BRL",
  aconteceuEm: new Date("2026-09-25T18:00:00Z"),
  ctwaClid: null,
  telefone: "(81) 99999-0000",
  email: null,
};

describe("montaEvento", () => {
  it("com clique do anúncio, atribui a conversa ao anúncio", () => {
    const e = montaEvento({ ...VENDA, ctwaClid: "clid-abc" }, CRED)!;
    expect(e.event_name).toBe("Purchase");
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

  it("venda sem valor não carrega custom_data", () => {
    const e = montaEvento({ ...VENDA, valorCentavos: null }, CRED)!;
    expect(e.custom_data).toBeUndefined();
  });

  it("lead qualificado vira Lead, com id próprio e sem valor", () => {
    const e = montaEvento({ ...VENDA, tipo: "lead" }, CRED)!;
    expect(e.event_name).toBe("Lead");
    // Id diferente do da venda: o mesmo negócio manda os dois, e id igual faria
    // o Meta descartar o segundo como repetição.
    expect(e.event_id).toBe("lead-1-lead");
    expect(e.custom_data).toBeUndefined();
  });
});

describe("fatoDaEtapa", () => {
  const etapa = (id: string, position: number, extra: Partial<Record<string, boolean>> = {}) => ({
    id,
    position,
    is_won: Boolean(extra.is_won),
    is_lost: Boolean(extra.is_lost),
    is_archived: Boolean(extra.is_archived),
  });
  const FUNIL = [
    etapa("entrada", 1000),
    etapa("android", 3000),
    etapa("boleto", 2000),
    etapa("ganho", 9000, { is_won: true }),
    etapa("perdido", 9500, { is_lost: true }),
    etapa("velha", 100, { is_archived: true }),
  ];

  it("etapa de ganho vira venda, de qualquer origem", () => {
    expect(fatoDaEtapa(FUNIL, "ganho", "android")).toBe("venda");
    expect(fatoDaEtapa(FUNIL, "ganho", null)).toBe("venda");
  });

  it("sair da caixa de entrada vira lead qualificado", () => {
    expect(fatoDaEtapa(FUNIL, "android", "entrada")).toBe("lead");
    expect(fatoDaEtapa(FUNIL, "boleto", "entrada")).toBe("lead");
  });

  it("andar entre colunas do meio não vira nada", () => {
    expect(fatoDaEtapa(FUNIL, "boleto", "android")).toBeNull();
  });

  it("voltar para a caixa de entrada e perder não viram nada", () => {
    expect(fatoDaEtapa(FUNIL, "entrada", "android")).toBeNull();
    expect(fatoDaEtapa(FUNIL, "perdido", "android")).toBeNull();
  });

  it("etapa arquivada não pode ser a caixa de entrada", () => {
    // `velha` tem a menor posição, mas está arquivada: quem manda é a primeira
    // etapa VIVA. Sem isso, sair de `entrada` deixaria de contar como lead.
    expect(fatoDaEtapa(FUNIL, "android", "entrada")).toBe("lead");
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
