/**
 * FILTRO POR DATA DE ENTRADA — "quantos leads entraram no periodo".
 *
 * Olha `created_at`, e nao a ultima atividade: um lead de setembro que o
 * vendedor moveu ontem entrou em setembro, nao ontem.
 *
 * ⚠️ A comparacao e no fuso de RECIFE. `created_at` e UTC, e um lead criado as
 * 23h de Recife e 02h do dia seguinte em UTC — recortar sobre a string crua
 * jogaria toda a entrada do fim da tarde para o dia de amanha.
 */
import { describe, expect, it } from "vitest";

import {
  applyFilters,
  diaDoNegocio,
  diaEmRecife,
  filtersFromParams,
  filtersToParams,
} from "@/lib/kanban/filters";
import type { Lead } from "@/lib/types/leads";

const lead = (id: string, criadoEm: string, fechadoEm: string | null = null): Lead =>
  ({
    closed_at: fechadoEm,
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
    last_activity_at: criadoEm,
    created_at: criadoEm,
    updated_at: criadoEm,
    // `as unknown as Lead`: a fabrica traz so o que o filtro le; o tipo real tem
    // mais campos, e a conversao direta nao basta para o compilador.
  }) as unknown as Lead;

describe("dia em Recife", () => {
  it("23h de Recife continua sendo o mesmo dia, nao o seguinte", () => {
    // 2026-10-18T23:30 em Recife = 2026-10-19T02:30 UTC
    expect(diaEmRecife("2026-10-19T02:30:00Z")).toBe("2026-10-18");
  });

  it("meio-dia nao muda de dia", () => {
    expect(diaEmRecife("2026-10-18T15:00:00Z")).toBe("2026-10-18");
  });
});

describe("filtro por data de entrada", () => {
  const leads = [
    lead("setembro", "2026-09-20T13:00:00Z"),
    lead("inicio-out", "2026-10-01T13:00:00Z"),
    lead("meio-out", "2026-10-15T13:00:00Z"),
    lead("virada", "2026-10-19T02:30:00Z"), // 18/10 23h30 em Recife
  ];

  it("sem datas, nao tira ninguem", () => {
    expect(applyFilters(leads, {})).toHaveLength(4);
  });

  it("so a ponta de inicio", () => {
    expect(applyFilters(leads, { entradaDe: "2026-10-01" }).map((l) => l.id)).toEqual([
      "inicio-out",
      "meio-out",
      "virada",
    ]);
  });

  it("so a ponta de fim", () => {
    expect(applyFilters(leads, { entradaAte: "2026-10-01" }).map((l) => l.id)).toEqual([
      "setembro",
      "inicio-out",
    ]);
  });

  it("intervalo fechado inclui as duas pontas", () => {
    const r = applyFilters(leads, { entradaDe: "2026-10-01", entradaAte: "2026-10-15" });
    expect(r.map((l) => l.id)).toEqual(["inicio-out", "meio-out"]);
  });

  it("o lead das 23h fica no dia dele, nao no seguinte", () => {
    const r = applyFilters(leads, { entradaDe: "2026-10-18", entradaAte: "2026-10-18" });
    expect(r.map((l) => l.id)).toEqual(["virada"]);
  });

  it("lead sem data de criacao nao entra num recorte de periodo", () => {
    const semData = { ...lead("sem", "2026-10-10T13:00:00Z"), created_at: null } as unknown as Lead;
    expect(applyFilters([semData], { entradaDe: "2026-01-01" })).toHaveLength(0);
  });

  it("vai e volta pela URL", () => {
    const f = { entradaDe: "2026-10-01", entradaAte: "2026-10-19" };
    const params = new URLSearchParams(filtersToParams(f));
    const volta = filtersFromParams(params);
    expect(volta.entradaDe).toBe("2026-10-01");
    expect(volta.entradaAte).toBe("2026-10-19");
  });
});

describe("venda conta pelo dia da venda, nao pelo da entrada", () => {
  // Caso real do funil da Space: entrou em 13/10, fechou em 16/10.
  const heitor = lead("heitor", "2026-10-13T13:00:00Z", "2026-10-16T13:00:00Z");
  const aberto = lead("aberto", "2026-10-13T13:00:00Z");

  it("a data do negocio fechado e a do fechamento", () => {
    expect(diaDoNegocio(heitor)).toBe("2026-10-16");
    expect(diaDoNegocio(aberto)).toBe("2026-10-13");
  });

  it("recorte da semana pega a venda, mesmo com o lead vindo de antes", () => {
    const r = applyFilters([heitor, aberto], {
      entradaDe: "2026-10-16",
      entradaAte: "2026-10-19",
    });
    expect(r.map((l) => l.id)).toEqual(["heitor"]);
  });

  it("no recorte da entrada, a venda ja fechada fica de fora", () => {
    const r = applyFilters([heitor, aberto], {
      entradaDe: "2026-10-13",
      entradaAte: "2026-10-13",
    });
    expect(r.map((l) => l.id)).toEqual(["aberto"]);
  });

  it("venda de setembro nao aparece no recorte de outubro", () => {
    const antiga = lead("antiga", "2026-09-01T13:00:00Z", "2026-09-20T13:00:00Z");
    const r = applyFilters([antiga], { entradaDe: "2026-10-01" });
    expect(r).toHaveLength(0);
  });
});
