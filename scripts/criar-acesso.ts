/**
 * Cria o acesso de um membro JÁ PRONTO: usuário com senha, e-mail confirmado e
 * vínculo com a organização. Sem link de convite e sem passo de aceite.
 *
 * O convite por link é o caminho normal, e continua sendo o melhor: a senha
 * nasce com a pessoa e ninguém mais a conhece. Este script existe para quando o
 * convidado não consegue completar o aceite, que é um lugar onde se perde
 * cliente por motivo bobo.
 *
 * IDEMPOTENTE: rodar de novo para o mesmo e-mail redefine a senha em vez de
 * quebrar, e o vínculo com a organização só é criado se ainda não existir.
 *
 * Uso:
 *   EMAIL=fulano@x.com NOME="Fulano" ROLE=manager npx tsx \
 *     --env-file=.env --env-file=.env.local scripts/criar-acesso.ts
 */
import { randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const ORG = process.env.ORG_ID ?? "10e5e6fd-21e9-4fd1-bb80-921d273d53d3";
const EMAIL = (process.env.EMAIL ?? "").trim().toLowerCase();
const NOME = process.env.NOME ?? "";
const ROLE = process.env.ROLE ?? "manager";

const PAPEIS = ["viewer", "agent", "ai_operator", "manager", "admin"];

/**
 * Senha legível de digitar no celular, que é onde o time da loja vai entrar.
 * Sem caracteres que se confundem entre si (l/1/I, O/0) — errar a senha e
 * culpar o sistema é o desfecho que este cuidado evita.
 */
function senhaLegivel(): string {
  const alfabeto = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(14);
  let s = "";
  for (const b of bytes) s += alfabeto[b % alfabeto.length];
  return `${s.slice(0, 5)}-${s.slice(5, 10)}-${s.slice(10, 14)}`;
}

async function main(): Promise<void> {
  if (!EMAIL) throw new Error("faltou EMAIL=<endereco>");
  if (!PAPEIS.includes(ROLE)) {
    throw new Error(`ROLE invalido: "${ROLE}". Use um de: ${PAPEIS.join(", ")}`);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, key, { auth: { persistSession: false } });
  // SENHA fixa quando quem opera precisa ditar a senha (o convidado nao
  // conseguiu completar o aceite e vai receber a credencial por mensagem).
  // O padrao continua sendo a gerada: senha escolhida por humano e reusada
  // entre contas e essa e a que vaza junto.
  const senha = process.env.SENHA?.trim() || senhaLegivel();
  if (senha.length < 8) throw new Error("SENHA precisa ter ao menos 8 caracteres");

  // `listUsers` pagina: procurar só a primeira página acharia "não existe" para
  // uma instalação com muitos usuários e o createUser falharia com duplicidade.
  let userId: string | null = null;
  for (let pagina = 1; pagina <= 20 && !userId; pagina++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 200 });
    if (error) throw new Error(`listar usuarios: ${error.message}`);
    if (!data.users.length) break;
    const achou = data.users.find((u) => (u.email ?? "").toLowerCase() === EMAIL);
    if (achou) userId = achou.id;
  }

  if (userId) {
    const { error } = await admin.auth.admin.updateUserById(userId, { password: senha });
    if (error) throw new Error(`atualizar senha: ${error.message}`);
    console.log("usuario ja existia — senha redefinida");
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: EMAIL,
      password: senha,
      // Confirmado na criação: sem isto o login recusa esperando um clique em
      // e-mail de verificação que ninguém pediu.
      email_confirm: true,
      ...(NOME ? { user_metadata: { full_name: NOME } } : {}),
    });
    if (error || !data?.user) throw new Error(`criar usuario: ${error?.message}`);
    userId = data.user.id;
    console.log("usuario criado");
  }

  const { data: vinculo } = await admin
    .from("user_organizations")
    .select("id, role")
    .eq("user_id", userId)
    .eq("organization_id", ORG)
    .maybeSingle();

  if (vinculo) {
    const atual = (vinculo as { role: string }).role;
    if (atual !== ROLE) {
      const { error } = await admin
        .from("user_organizations")
        .update({ role: ROLE } as never)
        .eq("user_id", userId)
        .eq("organization_id", ORG);
      if (error) throw new Error(`atualizar papel: ${error.message}`);
      console.log(`papel alterado de ${atual} para ${ROLE}`);
    } else {
      console.log(`ja era membro como ${ROLE}`);
    }
  } else {
    const { error } = await admin.from("user_organizations").insert({
      user_id: userId,
      organization_id: ORG,
      role: ROLE,
      accepted_at: new Date().toISOString(),
    } as never);
    if (error) throw new Error(`associar a organizacao: ${error.message}`);
    console.log(`associado como ${ROLE}`);
  }

  console.log("");
  console.log(`  painel: ${process.env.NEXT_PUBLIC_APP_URL}`);
  console.log(`  e-mail: ${EMAIL}`);
  console.log(`  senha:  ${senha}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
