/**
 * Gera o LINK de convite sem disparar e-mail.
 *
 * A tela de convite só mostra o `accept_url` quando o envio de e-mail FALHA —
 * com o Resend configurado ela some, e quem quer entregar o link por WhatsApp
 * fica sem ele. Convidar de novo só para ver o link mandaria um segundo e-mail
 * ao convidado, que lê como cobrança.
 *
 * O token é HMAC autocontido (`lib/auth/invite-token.ts`): não existe linha no
 * banco para consultar, então gerar aqui com a MESMA função é a única forma de
 * obter um link idêntico ao que o produto emite — e é por isso que este script
 * importa a função em vez de reimplementar a assinatura.
 *
 * Uso:
 *   EMAIL=fulano@x.com ROLE=manager npx tsx --env-file=.env --env-file=.env.local \
 *     scripts/gerar-convite.ts
 */
import { randomUUID } from "node:crypto";

import { signInviteToken, INVITE_TTL_SECONDS } from "@/lib/auth/invite-token";

const ORG = process.env.ORG_ID ?? "10e5e6fd-21e9-4fd1-bb80-921d273d53d3";
const EMAIL = process.env.EMAIL;
const ROLE = process.env.ROLE ?? "manager";

const PAPEIS = ["viewer", "agent", "ai_operator", "manager", "admin"];

function main(): void {
  if (!EMAIL) throw new Error("faltou EMAIL=<endereco>");
  if (!PAPEIS.includes(ROLE)) {
    throw new Error(`ROLE invalido: "${ROLE}". Use um de: ${PAPEIS.join(", ")}`);
  }
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) throw new Error("faltou NEXT_PUBLIC_APP_URL no env");

  // O e-mail entra em minúsculas porque é assim que o accept compara — um
  // convite emitido com maiúscula seria recusado na hora de aceitar.
  const email = EMAIL.trim().toLowerCase();
  const exp = Math.floor(Date.now() / 1000) + INVITE_TTL_SECONDS;
  const token = signInviteToken({
    invite_id: randomUUID(),
    email,
    organization_id: ORG,
    role: ROLE,
    exp,
  });

  const url = `${base.replace(/\/$/, "")}/team/accept-invite/${token}`;
  const validade = new Date(exp * 1000).toLocaleString("pt-BR", { timeZone: "America/Recife" });

  console.log(`convite para ${email} como ${ROLE}`);
  console.log(`valido ate ${validade} (horario de Recife)`);
  console.log("");
  console.log(url);
}

main();
