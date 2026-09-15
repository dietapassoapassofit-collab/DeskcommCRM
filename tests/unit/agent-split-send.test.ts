import { describe, expect, it, vi } from "vitest";

import { sendInBubbles } from "@/lib/agent-engine/agent/split-message";

describe("sendInBubbles", () => {
  it("split off → 1 envio com o corpo inteiro", async () => {
    const send = vi.fn(async () => ({ kind: "sent", messageId: "m" }));
    const sleep = vi.fn(async () => undefined);
    const out = await sendInBubbles("um texto qualquer", { enabled: false, maxChars: 600, send, sleep, jitter: () => 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("um texto qualquer");
    expect(out.kind).toBe("sent");
  });

  it("split on + texto longo → N envios com jitter entre eles", async () => {
    const send = vi.fn(async () => ({ kind: "sent", messageId: "m" }));
    const sleep = vi.fn(async () => undefined);
    const text = "Primeira ideia aqui.\n\nSegunda ideia aqui.\n\nTerceira ideia aqui.";
    const out = await sendInBubbles(text, { enabled: true, maxChars: 25, send, sleep, jitter: () => 900 });
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(sleep).toHaveBeenCalledWith(900); // jitter entre bolhas
    expect(out.kind).toBe("sent");
  });

  it("para no primeiro envio não-sent (veto/falha) e devolve esse outcome", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ kind: "sent", messageId: "m1" })
      .mockResolvedValueOnce({ kind: "blocked" });
    const sleep = vi.fn(async () => undefined);
    const text = "Bolha um aqui.\n\nBolha dois aqui.\n\nBolha três aqui.";
    const out = await sendInBubbles(text, { enabled: true, maxChars: 20, send, sleep, jitter: () => 0 });
    expect(out.kind).toBe("blocked");
    expect(send).toHaveBeenCalledTimes(2); // parou na 2ª
  });

  it("maxBubbles: 10 parágrafos com teto 3 → 3 envios, o excedente vai junto na última", async () => {
    const send = vi.fn(async () => ({ kind: "sent", messageId: "m" }));
    const sleep = vi.fn(async () => undefined);
    const paragrafos = Array.from({ length: 10 }, (_, i) => `Linha ${i + 1}.`);
    const out = await sendInBubbles(paragrafos.join("\n\n"), {
      enabled: true,
      maxChars: 140,
      maxBubbles: 3,
      send,
      sleep,
      jitter: () => 0,
    });
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0]?.[0]).toBe("Linha 1.");
    expect(send.mock.calls[1]?.[0]).toBe("Linha 2.");
    expect(send.mock.calls[2]?.[0]).toBe(paragrafos.slice(2).join("\n\n"));
    expect(out.kind).toBe("sent");
  });

  it("maxBubbles menor que 1 ainda manda uma mensagem (nunca some com a resposta)", async () => {
    const send = vi.fn(async () => ({ kind: "sent", messageId: "m" }));
    const sleep = vi.fn(async () => undefined);
    await sendInBubbles("Um.\n\nDois.", { enabled: true, maxChars: 140, maxBubbles: 0, send, sleep, jitter: () => 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("Um.\n\nDois.");
  });
});
