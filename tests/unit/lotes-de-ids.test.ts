/**
 * O QUADRO DO FUNIL PAROU DE ABRIR COM 400 NEGÓCIOS.
 *
 * A lista de ids vai na URL do PostgREST: 393 uuids viram `in.(...)` de ~14,7KB
 * e, com o token do usuário nos cabeçalhos, a requisição passa do teto de 16KB
 * do Node — o erro chega como `fetch failed` sem status, e a tela fica em
 * "Carregando..." para sempre (medido em 06/10/2026).
 *
 * Estes casos prendem o que o ajudante tem que garantir: lote limitado, nenhuma
 * linha perdida na junção, e erro de qualquer lote virando erro do conjunto —
 * meia resposta num quadro é pior que um erro visível.
 */
import { describe, it, expect } from "vitest";

import { consultaEmLotes, emLotes, IDS_POR_LOTE } from "@/lib/api/lotes-de-ids";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

describe("emLotes", () => {
  it("parte a lista no tamanho pedido e não perde ninguém", () => {
    const lotes = emLotes(ids(250), 100);
    expect(lotes.map((l) => l.length)).toEqual([100, 100, 50]);
    expect(lotes.flat()).toHaveLength(250);
  });

  it("lista vazia não vira lote nenhum", () => {
    expect(emLotes([])).toEqual([]);
  });

  it("o padrão deixa folga para cabeçalho e token", () => {
    // 100 uuids ≈ 3,8KB de URL, contra o teto de 16KB da requisição inteira.
    expect(IDS_POR_LOTE).toBeLessThanOrEqual(100);
  });
});

describe("consultaEmLotes", () => {
  it("junta as linhas de todos os lotes", async () => {
    const vistos: number[] = [];
    const r = await consultaEmLotes(
      ids(250),
      async (lote) => {
        vistos.push(lote.length);
        return { data: lote.map((id) => ({ id })), error: null };
      },
      100,
    );
    expect(vistos).toEqual([100, 100, 50]);
    expect(r.data).toHaveLength(250);
    expect(r.error).toBeNull();
  });

  it("erro em um lote vira erro do conjunto, sem resposta pela metade", async () => {
    const r = await consultaEmLotes(
      ids(150),
      async (lote) =>
        lote[0] === "id-100"
          ? { data: null, error: { message: "o banco recusou" } }
          : { data: lote.map((id) => ({ id })), error: null },
      100,
    );
    expect(r.error).toBe("o banco recusou");
    expect(r.data).toEqual([]);
  });

  it("sem ids, não chama o banco", async () => {
    let chamou = false;
    const r = await consultaEmLotes([], async () => {
      chamou = true;
      return { data: [], error: null };
    });
    expect(chamou).toBe(false);
    expect(r.data).toEqual([]);
  });
});
