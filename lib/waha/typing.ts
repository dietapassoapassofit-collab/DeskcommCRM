/**
 * Quanto tempo o "digitando..." fica no ar antes de a bolha sair.
 *
 * Proporcional ao tamanho do texto, porque presença de duração FIXA é a mesma
 * assinatura de bot que o jitter do pacing existe para apagar — só que visível
 * na tela do cliente em vez de no intervalo entre mensagens.
 *
 * O teto NÃO é a velocidade real de digitação: 140 caracteres num celular levam
 * uns 20s de dedo humano, e ninguém espera 20s por uma resposta de loja. O que
 * se imita é o GESTO (a bolha não nasce do nada), não a lentidão. Daí o corte
 * em 2,5s — acima disso a espera começa a custar mais do que a naturalidade
 * entrega, e o `sendInBubbles` ainda soma 1,2–2s entre bolhas por cima disto.
 */
export const TYPING_MS_POR_CARACTERE = 25;
export const TYPING_MS_MIN = 700;
export const TYPING_MS_MAX = 2_500;

export function typingDelayMs(texto: string): number {
  const n = (texto ?? "").trim().length;
  if (n === 0) return 0;
  const bruto = n * TYPING_MS_POR_CARACTERE;
  return Math.min(TYPING_MS_MAX, Math.max(TYPING_MS_MIN, bruto));
}
