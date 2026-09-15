/**
 * Material pronto da empresa — fotos e áudios gravados pela dona que o agente envia
 * quando as instruções mandam (ex.: o antes e depois de um cliente + o áudio contando o
 * caso dele). O modelo decide QUANDO; o conteúdo é fixo e não passa por ele.
 *
 * Configuração em `organizations.settings.materiais`:
 *   { "<id>": { "itens": [ { "kind": "image" | "audio", "path", "mime", "transcricao"? } ] } }
 * `transcricao` só em áudio: vai no corpo da mensagem, que é o que o histórico do modelo
 * lê no lugar do som. Imagem vai sem corpo — o corpo viraria legenda embaixo da foto.
 *
 * UMA VEZ POR CONTATO: o arquivo copiado para a conversa se chama
 * `material-<id>-<n>.<ext>`, e é pelo caminho gravado em `messages` que se sabe se já saiu.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { ChannelSendInput } from '../channel-adapter';
import { BEFORE_SEND_GATES } from '../guardrails/before-send';
import type { Queryable } from '../queue/queue';
import { copiarParaConversa } from './audio-de-boas-vindas';

type Midia = NonNullable<ChannelSendInput['media']>;

export interface ItemDeMaterial {
  kind: Midia['kind'];
  path: string;
  mime: string;
  transcricao?: string;
}

export type Materiais = Record<string, ItemDeMaterial[]>;

/**
 * Os gates que valem para material. O conteúdo é da EMPRESA, não texto do modelo: os
 * gates de conteúdo (promessa, vocabulário interno, disclosure) não têm o que avaliar, e
 * o spinning barra justamente a MESMA cópia indo para vários leads — que é o que um
 * material é. Ficam os que protegem o contato e o número: stop, LGPD e pacing.
 */
const NOMES_DOS_GATES_DE_MATERIAL = ['stop', 'lgpd', 'pacing'];
export const GATES_DE_MATERIAL = BEFORE_SEND_GATES.filter((g) => NOMES_DOS_GATES_DE_MATERIAL.includes(g.name));
// Um gate renomeado na cadeia sumiria deste filtro EM SILÊNCIO e o material sairia sem
// stop/LGPD. Melhor o worker não subir.
if (GATES_DE_MATERIAL.length !== NOMES_DOS_GATES_DE_MATERIAL.length) {
  throw new Error(
    `material-da-empresa: gates esperados ${NOMES_DOS_GATES_DE_MATERIAL.join(',')}, ` +
      `achados ${GATES_DE_MATERIAL.map((g) => g.name).join(',')}`,
  );
}

function itemValido(i: unknown): i is ItemDeMaterial {
  const x = i as Partial<ItemDeMaterial> | null;
  return (
    !!x &&
    (x.kind === 'image' || x.kind === 'audio') &&
    typeof x.path === 'string' &&
    x.path.length > 0 &&
    typeof x.mime === 'string' &&
    x.mime.length > 0
  );
}

/** Material com QUALQUER item inválido fica de fora inteiro — mandar pela metade é pior que não mandar. */
export function lerMateriais(settings: unknown): Materiais {
  const bruto = (settings as { materiais?: Record<string, { itens?: unknown }> } | null)?.materiais;
  const out: Materiais = {};
  if (!bruto || typeof bruto !== 'object') return out;
  for (const [id, material] of Object.entries(bruto)) {
    const itens: unknown[] = Array.isArray(material?.itens) ? material.itens : [];
    if (itens.length > 0 && itens.every(itemValido)) out[id] = itens;
  }
  return out;
}

export async function carregarMateriais(db: Queryable, tenantId: string): Promise<Materiais> {
  const { rows } = await db.query<{ settings: unknown }>('select settings from organizations where id = $1', [
    tenantId,
  ]);
  return lerMateriais(rows[0]?.settings);
}

export type MaterialPreparado =
  | { ok: true; envios: Array<{ body: string; media: Midia }> }
  | { ok: false; error: { code: string; message: string } };

/** Confere o material, garante que não saiu para este contato e copia os arquivos para a conversa. */
export async function prepararMaterial(
  deps: { db: Queryable; supabase: SupabaseClient },
  ids: { tenantId: string; leadId: string; conversationId: string; materialId: string },
): Promise<MaterialPreparado> {
  const materiais = await carregarMateriais(deps.db, ids.tenantId);
  const itens = materiais[ids.materialId];
  if (!itens) {
    const existentes = Object.keys(materiais);
    return {
      ok: false,
      error: {
        code: 'material_desconhecido',
        message:
          `não existe material "${ids.materialId}" nesta empresa` +
          (existentes.length > 0 ? ` — os que existem: ${existentes.join(', ')}.` : '.') +
          ' Siga a conversa sem ele.',
      },
    };
  }

  const prefixo = `/material-${ids.materialId}-`;
  const { rows } = await deps.db.query<{ ja: boolean }>(
    `select exists (
       select 1 from messages
       where organization_id = $1 and contact_id = $2 and direction = 'outbound'
         and strpos(media_storage_path, $3) > 0
     ) as ja`,
    [ids.tenantId, ids.leadId, prefixo],
  );
  if (rows[0]?.ja) {
    return {
      ok: false,
      error: {
        code: 'material_ja_enviado',
        message: `o material "${ids.materialId}" já foi enviado para este contato. Não mande de novo — siga a conversa.`,
      },
    };
  }

  const envios: Array<{ body: string; media: Midia }> = [];
  for (const [n, item] of itens.entries()) {
    const ext = /\.[a-z0-9]+$/i.exec(item.path)?.[0] ?? '';
    const destino = `${ids.tenantId}/${ids.conversationId}${prefixo}${n + 1}${ext}`;
    if ((await copiarParaConversa(deps.supabase, item.path, destino)) !== null) {
      return {
        ok: false,
        error: {
          code: 'material_indisponivel',
          message: 'não consegui preparar o material agora. Siga a conversa sem ele e não prometa enviar.',
        },
      };
    }
    envios.push({
      body: item.kind === 'audio' ? (item.transcricao ?? '') : '',
      media: { kind: item.kind, storagePath: destino, mime: item.mime },
    });
  }
  return { ok: true, envios };
}
