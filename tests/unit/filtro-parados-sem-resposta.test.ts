/**
 * "PARADOS SEM RESPOSTA" — o filtro que o disparo precisava.
 *
 * O controle que existia, "Apenas atrasados", olha `expected_close_date`, campo
 * que ninguém preenche nesta operação: na prática ele nunca filtrava nada.
 *
 * ⚠️ A conta mora aqui, e NÃO no radar de risco (`/leads/at-risk`), porque o
 * radar é paginado: devolve no máximo 200 linhas e a Space tem 367 negócios em
 * risco. A primeira versão filtrava por ele e, enquanto a consulta não voltava,
 * o conjunto chegava vazio e a tela ficava SEM NENHUM card — medido em
 * produção: 414 viraram 0.
 */
import { describe, expect, it } from "vitest";

import {
  applyFilters,
  filtersFromParams,
  filtersToParams,
  HORAS_SEM_RESPOSTA,
} from "@/lib/kanban/filters";
import type { Lead } from "@/lib/types/leads";

const AGORA = Date.now();
const ha = (horas: number) => new Date(AGORA - horas * 3_600_000).toISOString();

const lead = (id: string, extra: Partial<Lead> = {}): Lead =>
  ({
    id,
    organization_id: "org",
    pipeline_id: "funil",
    stage_id: "etapa",
    contact_id: "contato-" + id,
    title: "Negócio " + id,
    status: "open",
    value_cents: null,
    currency: "BRL",
    tags: [],
    owner_user_id: null,
    owner_agent_id: null,
    expected_close_date: null,
    position_in_stage: 1,
    last_activity_at: ha(1),
    created_at: ha(1),
    updated_at: ha(1),
    ...extra,
  }) as Lead;

describe("filtro de parados sem resposta", () => {
  it("desligado, não tira ninguém", () => {
    const leads = [lead("a", { last_activity_at: ha(100) }), lead("b")];
    expect(applyFilters(leads, {})).toHaveLength(2);
  });

  it("ligado, fica só quem passou do limiar", () => {
    const leads = [
      lead("parado", { last_activity_at: ha(HORAS_SEM_RESPOSTA + 1) }),
      lead("ativo", { last_activity_at: ha(2) }),
    ];
    expect(applyFilters(leads, { paradosOnly: true }).map((l) => l.id)).toEqual(["parado"]);
  });

  it("quem nunca teve atividade conta pela data de criação", () => {
    // São 191 dos 403 negócios abertos da Space (06/10/2026): sem este caso,
    // o filtro deixaria metade da base de fora.
    const leads = [
      lead("velho", { last_activity_at: null, created_at: ha(500) }),
      lead("novo", { last_activity_at: null, created_at: ha(3) }),
    ];
    expect(applyFilters(leads, { paradosOnly: true }).map((l) => l.id)).toEqual(["velho"]);
  });

  it("viaja na URL, para o filtro sobreviver ao recarregar", () => {
    expect(filtersToParams({ paradosOnly: true })).toBe("parados=1");
    expect(filtersFromParams(new URLSearchParams("parados=1")).paradosOnly).toBe(true);
  });

  it("soma com os outros filtros em vez de substituí-los", () => {
    const leads = [
      lead("a", { tags: ["WhatsApp"], last_activity_at: ha(100) }),
      lead("b", { tags: ["Instagram"], last_activity_at: ha(100) }),
    ];
    const r = applyFilters(leads, { paradosOnly: true, tag: "WhatsApp" });
    expect(r.map((l) => l.id)).toEqual(["a"]);
  });
});
