/**
 * POST /api/v1/ai/followups/enrollments/previa
 *
 * Diz quem do lote pode receber o disparo, ANTES de inscrever ninguém — e por
 * que cada um ficou de fora. O disparo em massa do funil chama isto ao abrir a
 * janela e só inscreve quem está apto.
 *
 * POST e não GET porque a lista de contatos vai no corpo: em GET ela viajaria
 * na URL, e foi exatamente assim que o quadro do funil quebrou em 06/10/2026
 * (`Headers Overflow Error` com 393 ids).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { consultaEmLotes } from "@/lib/api/lotes-de-ids";
import { montaPrevia } from "@/lib/followup/previa-do-disparo";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const previaSchema = z.object({
  contact_ids: z.array(z.string().uuid()).min(1).max(1000),
});

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("agent", { requestId, resource: "followup_enrollments" });
  if (!authz.ok) return authz.response;
  const org = authz.org.orgId;

  let bruto: unknown;
  try {
    bruto = await req.json();
  } catch {
    return fail("body_malformed", "Corpo inválido.", 400, { requestId });
  }
  const parsed = previaSchema.safeParse(bruto);
  if (!parsed.success) {
    return fail("validation_failed", "Lista de contatos inválida.", 422, { requestId });
  }
  const input = parsed.data;

  const supabase = await createClient();
  const ids = [...new Set(input.contact_ids)];

  const [contatos, inscritos, conversas] = await Promise.all([
    consultaEmLotes(ids, (lote) =>
      supabase
        .from("contacts")
        .select("id, is_blocked, is_anonymized, wa_identity")
        .eq("organization_id", org)
        .in("id", lote),
    ),
    consultaEmLotes(ids, (lote) =>
      supabase
        .from("followup_enrollments")
        .select("contact_id")
        .eq("organization_id", org)
        .eq("status", "active")
        .in("contact_id", lote),
    ),
    consultaEmLotes(ids, (lote) =>
      supabase
        .from("conversations")
        .select("contact_id, last_inbound_at")
        .eq("organization_id", org)
        .in("contact_id", lote),
    ),
  ]);

  const erro = contatos.error ?? inscritos.error ?? conversas.error;
  if (erro) return fail("internal_error", erro, 500, { requestId });

  const previa = montaPrevia(
    ids,
    contatos.data as Array<{ id: string; is_blocked: boolean | null; is_anonymized: boolean | null; wa_identity: string | null }>,
    new Set((inscritos.data as Array<{ contact_id: string }>).map((i) => i.contact_id)),
    conversas.data as Array<{ contact_id: string; last_inbound_at: string | null }>,
    new Date(),
  );

  return ok(previa, { requestId });
}
