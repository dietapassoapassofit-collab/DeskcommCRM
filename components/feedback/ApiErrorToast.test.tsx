import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "@/lib/api/types";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

import { toast } from "sonner";
import { showApiError } from "@/components/feedback/ApiErrorToast";

describe("ApiErrorToast", () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.warning).mockClear();
    vi.mocked(toast.info).mockClear();
  });

  it("has at least 10 entries in the COPY map (covered via known codes)", () => {
    const knownCodes = [
      "body_malformed",
      "cursor_malformed",
      "validation_error",
      "auth_required",
      "forbidden_role",
      "resource_not_found",
      "tenant_not_found",
      "idempotency_conflict",
      "conversation_already_claimed",
      "rate_limited",
      "lgpd_anonymization_irreversible",
      "internal_error",
    ];
    for (const code of knownCodes) {
      vi.mocked(toast.error).mockClear();
      vi.mocked(toast.warning).mockClear();
      vi.mocked(toast.info).mockClear();
      showApiError(new ApiError(400, code, undefined, "req-x"));
      const total =
        vi.mocked(toast.error).mock.calls.length +
        vi.mocked(toast.warning).mock.calls.length +
        vi.mocked(toast.info).mock.calls.length;
      expect(total).toBeGreaterThan(0);
    }
    expect(knownCodes.length).toBeGreaterThanOrEqual(10);
  });

  it("calls toast.warning with canonical PT-BR for conversation_already_claimed", () => {
    showApiError(new ApiError(409, "conversation_already_claimed", undefined, "req-1"));
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith(
      "Outro atendente já assumiu.",
      expect.objectContaining({ description: "ID: req-1" }),
    );
  });

  it("calls toast.warning com mensagem humana para invalid_state (casos humanos, spec 15)", () => {
    showApiError(new ApiError(409, "invalid_state", undefined, "req-3"));
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith(
      "Este caso já foi respondido ou fechado.",
      expect.objectContaining({ description: "ID: req-3" }),
    );
  });

  it("falls back to toast.error for unknown ApiError code", () => {
    const err = new ApiError(418, "unknown_teapot_code", undefined, "req-2", "I'm a teapot");
    showApiError(err);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "I'm a teapot",
      expect.objectContaining({ description: "ID: req-2" }),
    );
  });

  it("calls toast.error with generic message for non-ApiError", () => {
    showApiError(new Error("oops"));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("Erro inesperado. Tente novamente.");
  });
});

/**
 * CANCELAMENTO NÃO É ERRO.
 *
 * O vendedor clicava na conversa seguinte antes da anterior responder; a tela
 * cancelava a requisição em andamento e o CRM respondia com "Erro inesperado.
 * Tente novamente." — três toasts empilhados na tela dele em 30/09/2026,
 * enquanto o Caddy registrava `aborting with incomplete response` com menos de
 * 1s de duração. Nada estava quebrado: o CRM gritava com o próprio cancelamento.
 *
 * Estouro de tempo continua aparecendo, com o nome certo: esse é problema de
 * conexão e o vendedor precisa saber.
 */
describe("showApiError — cancelamento e estouro de tempo", () => {
  // Limpa aqui tambem: este bloco vive FORA do describe de cima, e sem isto a
  // chamada de outro caso vazaria para o "nao foi chamado" deste.
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.warning).mockClear();
    vi.mocked(toast.info).mockClear();
  });

  it("cancelamento da própria tela não vira toast", () => {
    showApiError(new DOMException("cancelado", "AbortError"));
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("estouro de tempo fala de conexão, não de erro inesperado", () => {
    showApiError(new DOMException("passou de 10000ms", "TimeoutError"));
    expect(toast.error).toHaveBeenCalledWith(
      "A conexão demorou demais para responder.",
      { description: "Verifique a internet e tente de novo." },
    );
  });
});
