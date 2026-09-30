-- 0171 — A REGRA DE QUEM VÊ CONVERSA PARAVA DE PERGUNTAR POR LINHA.
--
-- ═══ O DEFEITO MEDIDO (30/09/2026) ═══
--
-- `conversations_select` chamava `fn_can_view_conversation(organization_id,
-- assigned_to_user_id)` — uma função POR LINHA que, por dentro, chama
-- `fn_is_platform_admin()` e `fn_user_role_in_org()` (esta duas vezes, por causa
-- do CASE) e ainda lê `organizations.settings`. Com 983 conversas, uma contagem
-- vira alguns milhares de consultas escondidas:
--
--     contar conversas como usuário ... 504,1ms / 500,7ms / 498,6ms
--     a mesma contagem sem RLS ........ 0,35ms
--
-- Pela API, a mesma leitura custava 0,29s com a service key e 0,95s com o token
-- do vendedor. Cada tela do inbox paga isso várias vezes.
--
-- ═══ O QUE MUDA, E O QUE NÃO MUDA ═══
--
-- A REGRA É A MESMA, escrita de outro jeito: o que não depende da linha sai do
-- laço. Cada `in (select ...)` aqui é um InitPlan — o Postgres resolve UMA vez
-- por consulta e depois só compara colunas. A função continua existindo (outros
-- caminhos podem chamá-la); o que sai é a chamada dentro da política.
--
--     depois da reescrita ... 1,1ms / 0,9ms / 0,9ms
--
-- ═══ POR QUE DÁ PARA CONFIAR NA EQUIVALÊNCIA ═══
--
-- Não por leitura: por prova. `prova-rls2.cjs` roda as duas expressões lado a
-- lado sobre TODAS as conversas do banco, para cada combinação de papel
-- (`agent`, `viewer`, `manager`, `admin`) × `visibility_mode`
-- (`own_and_unassigned`, `all`, valor inválido, chave ausente), mais membro
-- revogado, admin da plataforma e alguém fora de qualquer organização — 19
-- cenários, dentro de uma transação revertida no fim. Zero divergências.
--
-- A prova pegou um erro real antes da aplicação: `assigned_to_user_id =
-- auth.uid()` devolve NULL (não `false`) quando a conversa não tem dono, e a
-- expressão inteira virava NULL em 249 linhas. Em política NULL barra igual a
-- `false`, então o efeito seria o mesmo — mas depender disso é depender de
-- sorte. Daí o `coalesce(..., false)`.
--
-- `fn_user_role_in_org` só pode devolver os quatro papéis (há CHECK na coluna),
-- então `not in ('viewer','manager','admin')` é exatamente `agent` — o mesmo
-- conjunto que caía no `else` da função.
alter policy conversations_select on public.conversations
  using (
    (select public.fn_is_platform_admin())
    or organization_id in (
         select uo.organization_id
           from public.user_organizations uo
          where uo.user_id = (select auth.uid())
            and uo.revoked_at is null
            and uo.role in ('viewer', 'manager', 'admin'))
    or (
      organization_id in (
         select uo.organization_id
           from public.user_organizations uo
          where uo.user_id = (select auth.uid())
            and uo.revoked_at is null
            and uo.role not in ('viewer', 'manager', 'admin'))
      and (
        -- `coalesce` porque conversa sem dono faria a comparação virar NULL.
        coalesce(assigned_to_user_id = (select auth.uid()), false)
        or organization_id in (
             select uo.organization_id
               from public.user_organizations uo
               join public.organizations o on o.id = uo.organization_id
              where uo.user_id = (select auth.uid())
                and uo.revoked_at is null
                and uo.role not in ('viewer', 'manager', 'admin')
                and coalesce(o.settings->>'visibility_mode', 'own_and_unassigned') = 'all')
        or (
          assigned_to_user_id is null
          and organization_id in (
               select uo.organization_id
                 from public.user_organizations uo
                 join public.organizations o on o.id = uo.organization_id
                where uo.user_id = (select auth.uid())
                  and uo.revoked_at is null
                  and uo.role not in ('viewer', 'manager', 'admin')
                  and coalesce(o.settings->>'visibility_mode', 'own_and_unassigned') = 'own_and_unassigned')
        )
      )
    )
  );

comment on policy conversations_select on public.conversations is
  'Mesma regra de fn_can_view_conversation, escrita em conjuntos: o que não depende da linha vira InitPlan e é resolvido uma vez por consulta. 504ms → 1ms numa contagem de 983 conversas. Equivalência provada em 19 cenários (papel × visibility_mode × revogado × admin da plataforma × não-membro).';
