/**
 * GET   /api/v1/conversations/[id] — single conversation (handler em ../_handler.ts)
 * PATCH /api/v1/conversations/[id] — update status e/ou tags (handler em ../_handler.ts)
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { patchConversationSchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

import { getConversationHandler, patchConversationHandler } from "../_handler";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const supabase = await createClient();

  // Uma conferencia de usuario por requisicao. `loadAuthUser` ja valida o JWT
  // por dentro; o `getUser` que ficava aqui era uma segunda ida ao GoTrue
  // (~250ms) que nunca mudou o desfecho.
  const authUser = await loadAuthUser();
  if (!authUser) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }
  const user = authUser;
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) {
    return fail("no_active_org", "No active organization.", 403, { requestId });
  }

  try {
    const conv = await getConversationHandler(
      supabase,
      {
        organization_id: activeOrg.orgId,
        actor: { type: "user", id: user.id },
        requestId,
      },
      id,
    );
    return ok(conv, { requestId });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { requestId });
    }
    throw err;
  }
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const supabase = await createClient();

  // spec 13 §4: escrita é agent+ (viewer é read-only).
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const user = authz.user;
  const activeOrg = authz.org;

  let input;
  try {
    input = await validateRequest(patchConversationSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  try {
    const conv = await patchConversationHandler(
      supabase,
      {
        organization_id: activeOrg.orgId,
        actor: { type: "user", id: user.id },
        requestId,
      },
      id,
      input,
    );
    return ok(conv, { requestId });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { requestId });
    }
    throw err;
  }
}
