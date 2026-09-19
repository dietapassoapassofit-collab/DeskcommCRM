/**
 * POST /api/v1/ai/followup-flows/media — foto ou vídeo de um bloco Conteúdo.
 * GET  /api/v1/ai/followup-flows/media?path=… — link temporário para a prévia no editor.
 *
 * Guarda em `<org>/followup-media/<uuid>.<ext>`, no mesmo bucket das conversas.
 * O envio COPIA o arquivo para a conversa de cada lead
 * (`lib/agent-engine/agent/followup-turn.ts`): o original nunca é enviado e
 * nunca some pela remoção LGPD de um contato.
 *
 * `manager`, o mesmo papel que edita e publica o fluxo — quem não pode mexer no
 * fluxo não tem por que subir arquivo para ele.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { FOLLOWUP_MEDIA_FOLDER } from "@/lib/followup/graph-schema";
import { extFromMime } from "@/lib/messaging/media/types";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * O que o WhatsApp entrega como foto/vídeo de verdade. `webp` fica de fora: lá
 * ele vira figurinha. Os tetos são os do WhatsApp — acima deles o canal aceita o
 * envio e falha depois, com o lead sem receber.
 */
const TIPOS: Record<string, { kind: "image" | "video"; maxBytes: number }> = {
  "image/jpeg": { kind: "image", maxBytes: 5 * 1024 * 1024 },
  "image/png": { kind: "image", maxBytes: 5 * 1024 * 1024 },
  "video/mp4": { kind: "video", maxBytes: 16 * 1024 * 1024 },
};
const MAIOR_LIMITE = 16 * 1024 * 1024;

async function orgDoPedido(requestId: string, papel: "viewer" | "manager") {
  const authz = await requireRole(papel, { requestId, resource: "followup_flows" });
  if (!authz.ok) return { resposta: authz.response };
  const user = await loadAuthUser();
  const org = user ? await resolveActiveOrg(user) : null;
  if (!org) return { resposta: fail("no_active_org", "No active organization.", 403, { requestId }) };
  return { orgId: org.orgId };
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const org = await orgDoPedido(requestId, "manager");
  if ("resposta" in org) return org.resposta!;

  // Recusa pelo tamanho DECLARADO antes de ler o corpo — o check autoritativo
  // continua o `file.size` depois (Content-Length pode mentir).
  const declarado = Number(req.headers.get("content-length") ?? 0);
  if (declarado > MAIOR_LIMITE + 1_048_576) {
    return fail("payload_too_large", "Arquivo acima de 16 MB.", 413, { requestId });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return fail("validation_failed", "Campo 'file' (multipart) obrigatório.", 422, { requestId });
  }

  const mime = (file.type || "").split(";")[0]!.trim().toLowerCase();
  const tipo = TIPOS[mime];
  if (!tipo) {
    return fail("unsupported_media_type", "Envie uma foto (JPG ou PNG) ou um vídeo MP4.", 415, { requestId });
  }
  if (file.size <= 0) return fail("validation_failed", "Arquivo vazio.", 422, { requestId });
  if (file.size > tipo.maxBytes) {
    const limite = tipo.kind === "image" ? "5 MB" : "16 MB";
    return fail("payload_too_large", `Arquivo acima de ${limite} — o WhatsApp recusaria.`, 413, { requestId });
  }

  const storagePath = `${org.orgId}/${FOLLOWUP_MEDIA_FOLDER}/${randomUUID()}.${extFromMime(mime)}`;
  const admin = createAdminClient();
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage
    .from("whatsapp-media")
    .upload(storagePath, buffer, { contentType: mime, upsert: false });
  if (upErr) {
    console.error("[followup-flows.media] upload failed", upErr.message);
    return fail("internal_error", "Erro ao subir o arquivo.", 500, { requestId });
  }

  return ok(
    {
      storage_path: storagePath,
      mime,
      media_kind: tipo.kind,
      size_bytes: buffer.length,
      filename: file.name.slice(0, 200),
    },
    { requestId },
  );
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const org = await orgDoPedido(requestId, "viewer");
  if ("resposta" in org) return org.resposta!;

  const path = req.nextUrl.searchParams.get("path") ?? "";
  // Só arquivo do fluxo desta organização — o parâmetro vem do navegador.
  if (!path.startsWith(`${org.orgId}/${FOLLOWUP_MEDIA_FOLDER}/`) || path.includes("..")) {
    return fail("not_found", "Arquivo não encontrado.", 404, { requestId });
  }
  const { data, error } = await createAdminClient()
    .storage.from("whatsapp-media")
    .createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return fail("not_found", "Arquivo não encontrado.", 404, { requestId });
  return ok({ url: data.signedUrl }, { requestId });
}
