import type { FlowGraph } from "@/lib/followup/graph-schema";

export interface EnvioDaAgenda {
  /** ms desde a inscrição até este envio; null quando uma espera anterior é "smart" (a IA decide). */
  aposMs: number | null;
  modo: "ai_message" | "template" | "content";
}

/**
 * Os envios que o fluxo faz, em ordem, com o tempo acumulado desde a inscrição.
 * Parte do trigger e segue a aresta de fallback (`condition.type === "always"`),
 * ou a única aresta de saída quando só existe uma.
 *
 * ponytail: anda só pelo caminho padrão — fluxo com ramificação mostra esse caminho,
 * não todos os ramos. Basta para os fluxos lineares de hoje; ramificado pede árvore.
 */
export function agendaDoFluxo(graph: FlowGraph): EnvioDaAgenda[] {
  const nos = new Map(graph.nodes.map((n) => [n.id, n]));
  const saidas = (id: string) => graph.edges.filter((e) => e.source === id);
  const envios: EnvioDaAgenda[] = [];
  const visitados = new Set<string>();

  let atual: FlowGraph["nodes"][number] | undefined = graph.nodes.find((n) => n.type === "trigger");
  let aposMs: number | null = 0;
  while (atual && !visitados.has(atual.id)) {
    visitados.add(atual.id);
    if (atual.type === "wait") {
      aposMs = aposMs !== null && atual.config.mode === "fixed" ? aposMs + atual.config.duration_ms : null;
    }
    if (atual.type === "action" && (atual.config.mode === "ai_message" || atual.config.mode === "template")) {
      envios.push({ aposMs, modo: atual.config.mode });
    }
    if (atual.type === "content") envios.push({ aposMs, modo: "content" });
    const opcoes = saidas(atual.id);
    // Randomizador: a agenda segue o 1º caminho — os outros têm o mesmo ritmo
    // na maioria dos fluxos, e mostrar uma linha só é o que cabe no botão.
    type Aresta = (typeof opcoes)[number];
    let primeiroCaminho: Aresta | undefined;
    if (atual.type === "randomizer") {
      const alvo: string | undefined = atual.config.branches[0]?.id;
      primeiroCaminho = opcoes.find((e) => e.condition.type === "branch" && e.condition.branch_id === alvo);
    }
    const proxima: Aresta | undefined =
      primeiroCaminho ??
      opcoes.find((e) => (e as { condition?: { type?: string } }).condition?.type === "always") ??
      (opcoes.length === 1 ? opcoes[0] : undefined);
    atual = proxima ? nos.get(proxima.target) : undefined;
  }
  return envios;
}
