/**
 * QUEM PODE RECEBER, DECIDIDO ANTES DE INSCREVER.
 *
 * Medido em 14 dias na SpacePhone: 67 envios barrados dentro do motor — 36 por
 * mensagem repetida e 31 por Instagram fora das 24h. Os 31 do Instagram eram
 * desperdício puro: ocupavam vaga no lote e gastavam os 3 minutos de
 * espaçamento de cada um antes de morrer.
 *
 * Estes casos prendem o que a prévia promete — e, igual de importante, o que
 * ela NÃO promete: mensagem repetida depende do que o número mandar nos minutos
 * seguintes e continua sendo decidida na hora do envio.
 */
import { describe, expect, it } from "vitest";

import { montaPrevia } from "@/lib/followup/previa-do-disparo";

const AGORA = new Date("2026-10-06T18:00:00Z");
const ha = (horas: number) => new Date(AGORA.getTime() - horas * 3600_000).toISOString();

const zap = (id: string) => ({ id, is_blocked: false, is_anonymized: false, wa_identity: "phone:+5581999990000" });
const insta = (id: string) => ({ id, is_blocked: false, is_anonymized: false, wa_identity: "lid:ig.123" });

describe("montaPrevia", () => {
  it("deixa passar quem tem conversa e nada contra", () => {
    const p = montaPrevia(["a"], [zap("a")], new Set(), [{ contact_id: "a", last_inbound_at: ha(200) }], AGORA);
    expect(p.aptos).toEqual(["a"]);
    expect(p.fora).toEqual([]);
  });

  it("WhatsApp não tem janela: 200h sem falar continua apto", () => {
    const p = montaPrevia(["a"], [zap("a")], new Set(), [{ contact_id: "a", last_inbound_at: ha(200) }], AGORA);
    expect(p.aptos).toEqual(["a"]);
  });

  it("Instagram fora das 24h fica de fora; dentro, passa", () => {
    const fora = montaPrevia(["i"], [insta("i")], new Set(), [{ contact_id: "i", last_inbound_at: ha(25) }], AGORA);
    expect(fora.aptos).toEqual([]);
    expect(fora.resumo.instagram_fora_das_24h).toBe(1);

    const dentro = montaPrevia(["i"], [insta("i")], new Set(), [{ contact_id: "i", last_inbound_at: ha(2) }], AGORA);
    expect(dentro.aptos).toEqual(["i"]);
  });

  it("a conversa MAIS RECENTE manda quando o contato tem várias", () => {
    const p = montaPrevia(
      ["i"],
      [insta("i")],
      new Set(),
      [
        { contact_id: "i", last_inbound_at: ha(100) },
        { contact_id: "i", last_inbound_at: ha(1) },
      ],
      AGORA,
    );
    expect(p.aptos).toEqual(["i"]);
  });

  it("bloqueado, anonimizado, já em follow-up e sem conversa ficam de fora, cada um com seu motivo", () => {
    const p = montaPrevia(
      ["b", "n", "j", "s", "x"],
      [
        { id: "b", is_blocked: true, wa_identity: "phone:+55" },
        { id: "n", is_anonymized: true, wa_identity: "phone:+55" },
        zap("j"),
        zap("s"),
      ],
      new Set(["j"]),
      [
        { contact_id: "b", last_inbound_at: ha(1) },
        { contact_id: "n", last_inbound_at: ha(1) },
        { contact_id: "j", last_inbound_at: ha(1) },
      ],
      AGORA,
    );
    expect(p.aptos).toEqual([]);
    expect(p.resumo).toEqual({
      contato_bloqueado: 1,
      contato_anonimizado: 1,
      ja_em_follow_up: 1,
      sem_conversa: 1,
      contato_nao_encontrado: 1,
    });
  });

  it("id repetido no lote conta uma vez só", () => {
    const p = montaPrevia(["a", "a", "a"], [zap("a")], new Set(), [{ contact_id: "a", last_inbound_at: ha(1) }], AGORA);
    expect(p.aptos).toEqual(["a"]);
  });
});
