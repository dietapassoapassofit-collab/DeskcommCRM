/**
 * Cria e publica o fluxo de follow-up "Sumiu depois do preço" da Galega Imports.
 *
 * Existe como SCRIPT, e não como cliques no construtor, por um motivo que já
 * custou caro nesta instalação: o que vale em produção é o grafo gravado, não o
 * desenho na tela. Aqui o grafo passa pelo MESMO `validateFlowForPublish` que a
 * rota usa e é publicado pela MESMA RPC — se ele estiver inalcançável ou com
 * ramo descoberto, falha aqui, antes de o cliente receber silêncio.
 *
 * Idempotente pelo nome do fluxo: rodar de novo republica em vez de duplicar.
 *
 * Uso: npx tsx --env-file=.env --env-file=.env.local scripts/criar-followup-galega.ts
 */
import { createClient } from "@supabase/supabase-js";

import { validateFlowForPublish } from "@/lib/followup/validate-publish";
import { publishFollowupFlowVersion } from "@/lib/followup/publish";
import type { FlowGraph } from "@/lib/followup/graph-schema";

const ORG = process.env.ORG_ID ?? "10e5e6fd-21e9-4fd1-bb80-921d273d53d3";
const NOME = "Sumiu depois do preço";

const MIN = 60_000;
const HORA = 60 * MIN;

/**
 * Três toques, decisão do dono da loja. O 1º é o que converte; os outros dois
 * existem porque ele quer espremer o lead — e por isso as esperas ENTRE eles
 * crescem (21h, depois 48h). Insistência com intervalo curto é o que faz alguém
 * bloquear o número, e este chip é o mesmo do bot interno da CR.
 *
 * `cancel_on_reply` no gatilho: qualquer resposta do cliente encerra o fluxo na
 * hora. Sem isso o 2º toque sai depois de a conversa ter voltado, e o cliente
 * recebe cobrança enquanto negocia.
 */
function montarGrafo(templateId: string): FlowGraph {
  return {
  nodes: [
    { id: "t", type: "trigger", label: "Ficou em silêncio", position: { x: 0, y: 0 }, config: {} },
    {
      id: "a1",
      type: "action",
      label: "Retoma o aparelho que ele viu",
      position: { x: 0, y: 140 },
      config: {
        mode: "ai_message",
        prompt_hint:
          "O cliente perguntou por um aparelho e não respondeu mais. Retome citando O MESMO aparelho e " +
          "preço que você já passou — nunca um genérico. Uma frase curta, tom de quem lembrou dele, sem " +
          "cobrar resposta e sem pedir desculpa por escrever. Não repita a lista inteira de opções.",
      },
    },
    {
      id: "w1",
      type: "wait",
      label: "Espera até o dia seguinte",
      position: { x: 0, y: 280 },
      config: { mode: "fixed", duration_ms: 21 * HORA },
    },
    {
      id: "a2",
      type: "action",
      label: "Pergunta o que faltou",
      position: { x: 0, y: 420 },
      config: {
        mode: "ai_message",
        prompt_hint:
          "Segundo contato, ele não respondeu ao primeiro. Pergunte de forma direta e leve o que faltou " +
          "para fechar — se foi o preço, o modelo ou a memória. UMA pergunta só, curta. Não ofereça nada " +
          "ainda e não repita o preço.",
      },
    },
    {
      id: "w2",
      type: "wait",
      label: "Espera dois dias",
      position: { x: 0, y: 560 },
      config: { mode: "fixed", duration_ms: 48 * HORA },
    },
    {
      id: "a3",
      type: "action",
      label: "Última tentativa: alternativa e parcela",
      position: { x: 0, y: 700 },
      config: {
        mode: "ai_message",
        prompt_hint:
          "Terceiro e ÚLTIMO contato. Busque no catálogo um aparelho da mesma linha em faixa de preço " +
          "menor e ofereça, com nome e preço reais, ou lembre o valor da PARCELA do que ele viu (nunca o " +
          "total). Encerre deixando a porta aberta sem pedir resposta: se ele quiser, é só chamar. " +
          "Não escreva de novo depois desta.",
        fallback_template_id: templateId,
      },
    },
    { id: "fim", type: "end", label: "Encerra", position: { x: 0, y: 840 }, config: {} },
  ],
  edges: [
    { id: "e1", source: "t", target: "a1", condition: { type: "always" } },
    { id: "e2", source: "a1", target: "w1", condition: { type: "always" } },
    { id: "e3", source: "w1", target: "a2", condition: { type: "always" } },
    { id: "e4", source: "a2", target: "w2", condition: { type: "always" } },
    { id: "e5", source: "w2", target: "a3", condition: { type: "always" } },
    { id: "e6", source: "a3", target: "fim", condition: { type: "always" } },
    ],
  };
}

/**
 * Texto de retaguarda do 3º toque.
 *
 * A validação de publish EXIGE `fallback_template_id` em nó que acumula 24h ou
 * mais de espera, e a exigência é sobre entrega, não sobre estilo: passada a
 * janela de 24h o canal pode recusar mensagem livre, e o fluxo terminaria em
 * silêncio sem ninguém saber. O template é o que sai quando a mensagem escrita
 * na hora não pode sair.
 *
 * Por isso ele é auto-suficiente: não cita aparelho nem preço, porque nasce sem
 * ter consultado o catálogo.
 */
const TEMPLATE_FALLBACK = {
  title: "Follow-up — último contato",
  shortcut: "fup-ultimo",
  body:
    "Oi! Passando aqui pra deixar registrado que a gente continua à disposição na Galega Imports. " +
    "Se ainda estiver procurando um aparelho, é só me chamar que eu vejo o que tem disponível pra você.",
};

const TRIGGER = {
  kind: "silence" as const,
  params: { threshold_minutes: 180 },
  cancel_on_reply: true,
};

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, key, { auth: { persistSession: false } });

  // O template de retaguarda precisa EXISTIR antes do grafo: é ele que o nó
  // longo referencia, e publicar apontando para um id inexistente trocaria a
  // falha de agora por uma na hora do envio.
  const { data: tplExistente } = await admin
    .from("message_templates")
    .select("id")
    .eq("organization_id", ORG)
    .eq("shortcut", TEMPLATE_FALLBACK.shortcut)
    .maybeSingle();

  let templateId = tplExistente?.id as string | undefined;
  if (!templateId) {
    const { data: tpl, error: tplErr } = await admin
      .from("message_templates")
      .insert({ organization_id: ORG, ...TEMPLATE_FALLBACK })
      .select("id")
      .single();
    if (tplErr || !tpl) throw new Error(`criar template falhou: ${tplErr?.message}`);
    templateId = tpl.id as string;
    console.log(`template de retaguarda criado: ${templateId}`);
  } else {
    console.log(`template de retaguarda já existia: ${templateId}`);
  }

  const GRAFO = montarGrafo(templateId);

  // Validar ANTES de tocar no fluxo: um grafo com ramo descoberto publicado é
  // um cliente que entra no fluxo e nunca sai dele.
  const v = validateFlowForPublish(GRAFO);
  if (!v.ok) {
    console.error("grafo reprovado na validação de publish:");
    for (const e of v.errors ?? []) console.error(`  - ${JSON.stringify(e)}`);
    throw new Error("nada publicado");
  }
  console.log("grafo validado");

  const { data: existente } = await admin
    .from("followup_flow_pointers")
    .select("id")
    .eq("organization_id", ORG)
    .eq("name", NOME)
    .maybeSingle();

  let pointerId = existente?.id as string | undefined;
  if (!pointerId) {
    const { data: criado, error } = await admin
      .from("followup_flow_pointers")
      .insert({ organization_id: ORG, name: NOME })
      .select("id")
      .single();
    if (error || !criado) throw new Error(`criar pointer falhou: ${error?.message}`);
    pointerId = criado.id as string;
    console.log(`fluxo criado: ${pointerId}`);
  } else {
    console.log(`fluxo já existia, republicando: ${pointerId}`);
  }

  const { data: dono } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", ORG)
    .limit(1)
    .maybeSingle();
  const createdBy = (dono?.user_id as string | undefined) ?? null;
  if (!createdBy) throw new Error("nenhum membro na organização para assinar a publicação");

  const { error: cfgErr } = await admin
    .from("followup_flow_pointers")
    .update({ trigger_config: TRIGGER, draft_graph: GRAFO, handoff_policy: "cancel" })
    .eq("id", pointerId);
  if (cfgErr) throw new Error(`gravar trigger/draft falhou: ${cfgErr.message}`);

  const pub = await publishFollowupFlowVersion(admin, { orgId: ORG, pointerId, graph: GRAFO, createdBy });
  if (!pub.ok) throw new Error(`publish falhou (${pub.code}): ${pub.message}`);

  console.log(`publicado: versão ${pub.version_id}`);
  console.log(`gatilho: silêncio de ${TRIGGER.params.threshold_minutes} min, cancela na resposta`);
  console.log("toques: 3 (imediato, +21h, +48h)");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
