/**
 * Conversão de venda → anúncio: a venda fechada no funil volta para o Meta.
 *
 * O CRM já guarda de qual anúncio o contato veio (`contacts.source_metadata`,
 * `lib/leads/atribuicao-de-anuncio.ts` — PRIMEIRO TOQUE, nunca reescrito). Sem
 * este módulo esse dado morre dentro do CRM: o Meta enxerga a conversa que o
 * anúncio abriu e nunca a venda que ela virou, e a campanha otimiza para
 * conversa em vez de para dinheiro.
 *
 * ⚠️ O ENDEREÇO DA API VEM DO AMBIENTE, e não é preguiça de configuração: o
 * nome do provider é proibido fora de `lib/channels/` pela doutrina de
 * restrição de canal (`npm run lint:channels`). Este módulo não é um canal —
 * não entrega mensagem para ninguém —, então o host mora no `.env`
 * (`META_CAPI_ENDPOINT`) e o código nunca o soletra.
 *
 * ⚠️ TUDO QUE É PII VAI EM SHA-256. O Meta exige e a LGPD agradece: telefone e
 * e-mail saem daqui como hash, nunca em claro. `ctwa_clid` não é PII — é o id
 * do clique que o próprio Meta gerou.
 */
import { createHash } from "node:crypto";

export interface CredenciaisDeConversao {
  /** Base da API, já sem barra final. Vem do `.env`. */
  endpoint: string;
  token: string;
  datasetId: string;
  /** Conta do WhatsApp dona do clique — o Meta usa para casar o `ctwa_clid`. */
  wabaId: string;
  /** Opcional: manda o evento para a aba de teste do Events Manager. */
  testCode?: string;
}

type Ambiente = Record<string, string | undefined>;

/**
 * Credencial por organização, lida do ambiente pelo slug
 * (`spacephone` → `META_CAPI_SPACEPHONE_TOKEN`).
 *
 * Org sem credencial devolve `null` e o envio é pulado — é assim que as outras
 * organizações da instalação ficam de fora sem precisar de flag.
 */
export function credenciaisDaOrg(
  slug: string,
  ambiente: Ambiente = process.env,
): CredenciaisDeConversao | null {
  const chave = slug.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const endpoint = (ambiente.META_CAPI_ENDPOINT ?? "").trim().replace(/\/+$/, "");
  const token = (ambiente[`META_CAPI_${chave}_TOKEN`] ?? "").trim();
  const datasetId = (ambiente[`META_CAPI_${chave}_DATASET_ID`] ?? "").trim();
  const wabaId = (ambiente[`META_CAPI_${chave}_WABA_ID`] ?? "").trim();
  if (!endpoint.startsWith("https://")) return null;
  if (!token || !datasetId || !wabaId) return null;
  const testCode = (ambiente.META_CAPI_TEST_CODE ?? "").trim();
  return { endpoint, token, datasetId, wabaId, testCode: testCode || undefined };
}

export const hash = (valor: string): string =>
  createHash("sha256").update(valor).digest("hex");

/** Só dígitos, com DDI. O Meta casa telefone normalizado; `+`, espaço e traço atrapalham. */
export function normalizaTelefone(bruto: string | null | undefined): string | null {
  const digitos = (bruto ?? "").replace(/\D/g, "");
  if (digitos.length < 10) return null;
  return digitos.length <= 11 ? `55${digitos}` : digitos;
}

/**
 * O que aconteceu no funil, na língua do Meta.
 *
 * `lead` é o cliente que o vendedor classificou numa coluna de produto — parou
 * de ser "quem respondeu a mensagem" e virou interesse declarado. `venda` é o
 * negócio ganho. Os dois vão para o mesmo dataset porque o Meta só aprende com
 * volume: venda são oito por mês, lead qualificado são setenta.
 */
export type TipoDeFato = "lead" | "venda";

export interface FatoDoFunil {
  tipo: TipoDeFato;
  /** Id do negócio no CRM. Compõe o `event_id` — é o que impede evento duplicado no Meta. */
  leadId: string;
  valorCentavos: number | null;
  moeda: string | null;
  aconteceuEm: Date;
  /** Id do clique no anúncio, quando o contato veio de um. */
  ctwaClid: string | null;
  telefone: string | null;
  email: string | null;
}

export interface EventoDeConversao {
  event_name: "Purchase" | "Lead";
  event_id: string;
  event_time: number;
  action_source: string;
  messaging_channel?: string;
  user_data: Record<string, string>;
  custom_data?: { currency: string; value: number };
}

/**
 * Monta o evento. Devolve `null` quando não há como o Meta reconhecer a pessoa
 * — evento sem identificador é recusado do outro lado e só gastaria tentativa.
 *
 * Duas formas, e a diferença importa: com `ctwa_clid` o evento é atribuído ao
 * anúncio que abriu a conversa (`business_messaging`); sem ele, sobra o
 * casamento por telefone/e-mail (`other`), que ajuda a otimização mas não
 * credita o anúncio.
 */
export function montaEvento(
  fato: FatoDoFunil,
  cred: CredenciaisDeConversao,
): EventoDeConversao | null {
  const userData: Record<string, string> = {};
  if (fato.ctwaClid) {
    userData.ctwa_clid = fato.ctwaClid;
    userData.whatsapp_business_account_id = cred.wabaId;
  }
  const telefone = normalizaTelefone(fato.telefone);
  if (telefone) userData.ph = hash(telefone);
  const email = (fato.email ?? "").trim().toLowerCase();
  if (email) userData.em = hash(email);
  if (Object.keys(userData).length === 0) return null;

  const evento: EventoDeConversao = {
    event_name: fato.tipo === "venda" ? "Purchase" : "Lead",
    // O sufixo separa os dois eventos do MESMO negócio: sem ele, o `Lead` e o
    // `Purchase` do mesmo cliente teriam o mesmo id e o Meta descartaria o
    // segundo como repetição.
    event_id: fato.tipo === "venda" ? fato.leadId : `${fato.leadId}-lead`,
    event_time: Math.floor(fato.aconteceuEm.getTime() / 1000),
    action_source: fato.ctwaClid ? "business_messaging" : "other",
    user_data: userData,
  };
  if (fato.ctwaClid) evento.messaging_channel = "whatsapp";
  if (fato.tipo === "venda" && fato.valorCentavos && fato.valorCentavos > 0) {
    evento.custom_data = {
      currency: fato.moeda || "BRL",
      value: fato.valorCentavos / 100,
    };
  }
  return evento;
}

export interface ResultadoDoEnvio {
  ok: boolean;
  /** `true` quando o erro é de rede/5xx — vale tentar de novo. */
  retentavel: boolean;
  detalhe: string;
}

/**
 * POST do evento. Erro 4xx NÃO é retentável: payload errado não melhora na
 * segunda tentativa, e insistir só enche o log do drain.
 */
export async function enviaConversao(
  evento: EventoDeConversao,
  cred: CredenciaisDeConversao,
  buscar: typeof fetch = fetch,
): Promise<ResultadoDoEnvio> {
  const corpo: Record<string, unknown> = { data: [evento], access_token: cred.token };
  if (cred.testCode) corpo.test_event_code = cred.testCode;

  let resposta: Response;
  try {
    resposta = await buscar(`${cred.endpoint}/${cred.datasetId}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return {
      ok: false,
      retentavel: true,
      detalhe: `rede: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const texto = (await resposta.text()).slice(0, 300);
  if (resposta.ok) return { ok: true, retentavel: false, detalhe: texto };
  return {
    ok: false,
    retentavel: resposta.status >= 500 || resposta.status === 429,
    detalhe: `http ${resposta.status}: ${texto}`,
  };
}
