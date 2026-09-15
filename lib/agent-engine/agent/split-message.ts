/**
 * Quebra o texto da resposta em "bolhas" curtas (Onda 4) — parágrafo → sentença
 * → palavra. Puro. Usado no send do agente quando split_messages está on; o
 * pacing anti-ban espaça cada bolha. Nunca devolve bolha vazia nem (salvo
 * palavra atômica gigante) > maxChars.
 *
 * `maxChars` é TETO, NUNCA ALVO — e essa distinção é o comportamento inteiro.
 * Antes, unidades adjacentes eram coladas com espaço enquanto coubessem, o que
 * DESFAZIA a separação que o autor escreveu: três celulares em três linhas,
 * somando 134 caracteres, voltavam ao cliente como um parágrafo corrido de
 * preços. Quem lê no WhatsApp precisa varrer isso com o olho para achar o valor
 * de cada aparelho — que é justamente o momento em que ele desiste.
 *
 * Então parágrafo (`\n{2,}`) é fronteira DURA: cada um vira ao menos uma bolha.
 * A junção sobrevive só onde tem sentido — entre sentenças de um MESMO
 * parágrafo que estourou o teto e precisou ser fatiado. Texto sem parágrafo
 * nenhum se comporta exatamente como antes.
 */
export function splitIntoBubbles(text: string, maxChars: number): string[] {
  return splitIntoPieces(text, maxChars).map((p) => p.texto);
}

/** Bolha + o parágrafo de onde ela saiu — é o que diz como religar bolhas vizinhas. */
interface Pedaco {
  texto: string;
  paragrafo: number;
}

function splitIntoPieces(text: string, maxChars: number): Pedaco[] {
  const trimmed = (text ?? "").trim();
  if (trimmed === "") return [];

  const bubbles: Pedaco[] = [];
  const paragrafos = trimmed.split(/\n{2,}/);
  for (let indice = 0; indice < paragrafos.length; indice++) {
    const p = paragrafos[indice]!.trim();
    if (p === "") continue;
    if (p.length <= maxChars) {
      bubbles.push({ texto: p, paragrafo: indice });
      continue;
    }
    // Parágrafo grande demais: fatia em sentenças e reagrupa até o teto. A
    // reagrupagem fica CONFINADA a este parágrafo — não encosta no vizinho.
    const pedacos: string[] = [];
    for (const sentence of splitSentences(p)) {
      if (sentence.length <= maxChars) pedacos.push(sentence);
      else pedacos.push(...splitWords(sentence, maxChars));
    }
    let cur = "";
    for (const u of pedacos) {
      const joined = cur === "" ? u : `${cur} ${u}`;
      if (joined.length <= maxChars) {
        cur = joined;
      } else {
        if (cur !== "") bubbles.push({ texto: cur, paragrafo: indice });
        cur = u;
      }
    }
    if (cur !== "") bubbles.push({ texto: cur, paragrafo: indice });
  }
  return bubbles;
}

/** Divide em sentenças mantendo a pontuação final (. ! ?). */
function splitSentences(text: string): string[] {
  const out = text.match(/[^.!?]+[.!?]*/g);
  return (out ?? [text]).map((s) => s.trim()).filter((s) => s !== "");
}

/** Última linha de defesa: agrupa palavras até maxChars; palavra atômica > max vai sozinha. */
function splitWords(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/)) {
    if (w === "") continue;
    const joined = cur === "" ? w : `${cur} ${w}`;
    if (joined.length <= maxChars) cur = joined;
    else {
      if (cur !== "") out.push(cur);
      cur = w;
    }
  }
  if (cur !== "") out.push(cur);
  return out;
}

/**
 * Outcome mínimo que o send do canal devolve (subconjunto usado aqui).
 * messageId casa com o shape real de ChannelSendResult (string | null | undefined
 * conforme o kind) — não apenas string opcional.
 */
export interface BubbleOutcome {
  kind: string;
  messageId?: string | null;
}

export interface SendInBubblesOpts<T extends BubbleOutcome = BubbleOutcome> {
  enabled: boolean;
  maxChars: number;
  send: (body: string) => Promise<T>;
  sleep: (ms: number) => Promise<void>;
  /** ms de jitter humano entre bolhas (só entre, não antes da 1ª). */
  jitter: () => number;
  /**
   * Teto de bolhas DESTE envio (o que resta do teto de mensagens do turno). O que
   * passar vai junto na última bolha, com as quebras de parágrafo preservadas.
   * Ausente = sem teto.
   */
  maxBubbles?: number;
}

/**
 * Junta o excedente na última bolha permitida. Existe porque o teto por turno só era
 * checado ANTES da chamada de envio: um corpo de 10 parágrafos saía como 10 mensagens
 * em sequência (medido em produção, 15/09/2026).
 *
 * Religa pelo parágrafo de origem: pedaços do MESMO parágrafo voltam com espaço (são
 * a mesma frase fatiada pelo teto de caracteres), parágrafos diferentes com linha em
 * branco. Juntar tudo com "\n\n" abriu uma linha em branco no meio de uma frase
 * ("voltar a ter essa" / "possibilidade") numa mensagem real, 15/09/2026.
 */
function capBubbles(pedacos: Pedaco[], maxBubbles: number | undefined): string[] {
  if (maxBubbles === undefined || pedacos.length <= maxBubbles) return pedacos.map((p) => p.texto);
  const teto = Math.max(1, Math.floor(maxBubbles));
  const resto = pedacos.slice(teto - 1);
  let ultima = resto[0]!.texto;
  for (let i = 1; i < resto.length; i++) {
    ultima += (resto[i]!.paragrafo === resto[i - 1]!.paragrafo ? " " : "\n\n") + resto[i]!.texto;
  }
  return [...pedacos.slice(0, teto - 1).map((p) => p.texto), ultima];
}

/**
 * Envia o corpo em bolhas quando `enabled`; senão um envio só. Cada bolha passa
 * pelo mesmo `send` (que no runtime é o channel.send pós-guardrails, com seq++).
 * Para no 1º outcome que não seja de sucesso ('sent'/'already_sent'/'queued')
 * e o devolve — não segue mandando bolha após veto/bloqueio/falha.
 *
 * LIMITAÇÃO CONHECIDA: o contador de cap diário do pacing anti-ban (recordSend)
 * conta o send lógico UMA vez por turno, então um turno de N bolhas avança o cap
 * em 1, não N — aceitável por ora (doutrina: "anti-ban gateia uma vez"); revisitar
 * se o warm-up precisar de precisão por mensagem física.
 */
const OK_KINDS = new Set(["sent", "already_sent", "queued"]);

export async function sendInBubbles<T extends BubbleOutcome>(
  body: string,
  opts: SendInBubblesOpts<T>,
): Promise<T> {
  const bubbles = capBubbles(
    opts.enabled ? splitIntoPieces(body, opts.maxChars) : [{ texto: body, paragrafo: 0 }],
    opts.maxBubbles,
  );
  if (bubbles.length === 0) return opts.send(body); // corpo vazio: deixa o canal decidir
  let last: T | undefined;
  for (let i = 0; i < bubbles.length; i++) {
    if (i > 0) await opts.sleep(opts.jitter());
    last = await opts.send(bubbles[i]!);
    if (!OK_KINDS.has(last.kind)) return last; // veto/bloqueio/falha: para aqui
  }
  return last!;
}
