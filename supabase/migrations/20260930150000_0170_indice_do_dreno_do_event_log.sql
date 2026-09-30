-- 0170 — O DRENO DO EVENT_LOG LIA A FILA INTEIRA PARA DESCARTAR QUASE TUDO.
--
-- ═══ O DEFEITO MEDIDO (30/09/2026) ═══
--
-- O select de `lib/event-log/drain.ts` filtra `status = 'pending'` mais
-- `event_type in (<tipos com handler registrado>)` e ordena por `created_at`.
-- O índice que existia (`event_log_pending_idx`) cobre só `status`, então o
-- plano varria TODA a fila parada e jogava fora o que não interessava:
--
--     Rows Removed by Filter: 9153
--     Execution Time: 2070.404 ms
--
-- Das 9.163 linhas paradas, 9.117 são tipos que NINGUÉM consome — `message.sent`
-- (7.584), `channel_session.status_changed` (1.070) e `message.outbound` (463),
-- acumulando desde 25/08. Elas ficam `pending` para sempre por desenho: o dreno
-- só toca tipo com handler registrado, e ninguém as apaga (a poda da 0167 cobre
-- `job_queue` e `api_audit_log`, não esta tabela).
--
-- O custo era pago a cada minuto, por todas as organizações da instalação. Com o
-- banco sob carga virou `canceling statement due to statement timeout` no cron —
-- e, no mesmo minuto, `PGRST002` na resolução de permissões: o inbox do cliente
-- mostrou "Erro inesperado. Tente novamente." e a lista de conversas ficou vazia.
--
-- ═══ POR QUE ÍNDICE, E NÃO APAGAR AS LINHAS ═══
--
-- Apagar resolve hoje e volta amanhã: a emissão desses eventos continua, e em um
-- mês a fila parada está do mesmo tamanho. O índice é o que torna o tamanho da
-- fila irrelevante para quem a dreno. Poda de `event_log` é um conserto separado,
-- e maior — tem que decidir o que fazer com evento que nunca foi consumido.
--
-- Parcial de propósito: o que interessa é a fila parada. `done` é a maioria da
-- tabela (14.679 linhas) e nunca entra neste select — indexá-la engordaria a
-- escrita de todo evento do produto para nada.
--
-- ═══ MEDIDO DEPOIS, NO MESMO BANCO E NO MESMO INSTANTE ═══
--
--     antes : Execution Time: 2070.404 ms
--     depois: Execution Time:    0.199 ms
--
-- Criado com CONCURRENTLY em produção (sem lock de escrita) antes desta
-- migration existir; aqui vai `if not exists` para o ambiente que ainda não tem.
create index if not exists event_log_pending_por_tipo_idx
  on public.event_log (event_type, created_at)
  where status = 'pending';

comment on index public.event_log_pending_por_tipo_idx is
  'Dreno do event_log: (event_type, created_at) só das linhas paradas. Sem ele o select varre a fila inteira, inclusive os tipos sem handler, que ficam parados para sempre.';
