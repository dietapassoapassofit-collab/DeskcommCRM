/**
 * POST /api/v1/ai/followup-flows/:id/enrollments (manager+) — pausa ou retoma
 * TODOS os leads que estão andando neste fluxo. É o "parar e dar play" de um
 * disparo em massa: a tela da fila é paginada, então mandar o navegador chamar
 * a rota de cada lead deixaria o lote pela metade quando alguém fechasse a aba.
 *
 * Reusa `pausaEnrollment`/`retomaEnrollment` — a mesma regra (e a mesma corrida
 * contra o motor) das rotas por lead, uma chamada por enrollment, aqui dentro.
 * Um lead que falhar não derruba os outros: o resultado conta quantos foram.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { pausaEnrollment, retomaEnrollment } from "@/lib/followup/intervencao";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Teto de segurança: acima disso a chamada estouraria o tempo da rota. */
const MAX_POR_CHAMADA = 500;

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: pointerId } = await ctx.params;

  const authz = await requireRole("manager", { requestId, resource: "followup_enrollments" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  const corpo = (await req.json().catch(() => ({}))) as { acao?: string };
  const acao = corpo.acao;
  if (acao !== "pause" && acao !== "resume") {
    return fail("invalid_request", 'acao precisa ser "pause" ou "resume".', 422, { requestId });
  }

  const supabase = await createClient();
  // Pausar alcança quem está andando; retomar, só quem um humano pausou —
  // `paused_handoff` é do atendimento humano e não se desfaz por aqui.
  const statusAlvo = acao === "pause" ? ["active", "waiting_reply"] : ["paused_manual"];
  const { data: linhas, error } = await supabase
    .from("followup_enrollments")
    .select("id")
    .eq("organization_id", org.orgId)
    .eq("pointer_id", pointerId)
    .in("status", statusAlvo)
    .limit(MAX_POR_CHAMADA);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const ids = (linhas ?? []).map((l) => (l as { id: string }).id);
  const deps = { supabase, admin: createAdminClient(), orgId: org.orgId, userId: user.id, requestId };
  let feitos = 0;
  let falhas = 0;
  for (const id of ids) {
    const r = acao === "pause" ? await pausaEnrollment(deps, id) : await retomaEnrollment(deps, id);
    if (r.ok) feitos += 1;
    else falhas += 1;
  }

  void audit({
    action: acao === "pause" ? "followup_flow.enrollments_paused" : "followup_flow.enrollments_resumed",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "followup_flow_pointer",
    resourceId: pointerId,
    requestId,
    metadata: { feitos, falhas, alcance: ids.length },
  });

  return ok({ feitos, falhas, alcance: ids.length, truncado: ids.length === MAX_POR_CHAMADA }, { requestId });
}
