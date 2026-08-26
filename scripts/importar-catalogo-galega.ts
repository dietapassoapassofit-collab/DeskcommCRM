/**
 * Espelha `products` (catálogo legado, importado das planilhas da loja) em
 * `store_products`, que é a tabela que a tool `buscar_produto` lê.
 *
 * POR QUE ISTO EXISTE: a migration 0169 criou `store_products` e a tool passou
 * a ler dela, mas nada nunca a populou. O agente respondia "não tem" para
 * QUALQUER produto — inclusive para os 105 aparelhos em estoque — e acertava
 * por acidente quando o cliente pedia algo que de fato não existia. Tool de
 * catálogo vazia é pior que tool nenhuma: ela responde com a autoridade de quem
 * consultou.
 *
 * ESPELHO, NÃO MERGE: `products` é a fonte (vem do ERP/planilha da loja), então
 * a carga apaga o que espelhou antes e reinsere. Roda dentro de UMA transação —
 * um erro no meio não pode deixar a loja com catálogo pela metade, que é
 * exatamente o estado em que o agente mente com confiança.
 *
 * CONDIÇÃO: `store_products` só aceita lacrado|seminovo|vitrine, e `products`
 * traz `novo` (27 iPhones) ou NULL (o resto). `novo` vira `lacrado` — é a mesma
 * coisa dita com a palavra que esta tabela usa. NULL vira `lacrado` por decisão
 * do dono da loja: acessório lacrado é o caso esmagador (3.117 de 3.222), e
 * aparelho que for seminovo se corrige no painel.
 *
 * Uso:  npx tsx --env-file=.env --env-file=.env.local scripts/importar-catalogo-galega.ts
 *       ORG_ID=<uuid> npx tsx ... scripts/importar-catalogo-galega.ts   (outra org)
 */
import pg from "pg";

const ORG_ID = process.env.ORG_ID ?? "10e5e6fd-21e9-4fd1-bb80-921d273d53d3";

const SQL_ESPELHAR = `
  with apagados as (
    delete from store_products where organization_id = $1 returning 1
  ), inseridos as (
    insert into store_products
      (organization_id, sku, name, category, condition, price_cents, stock_qty, active)
    select
      $1,
      p.external_code,
      p.name,
      p.category,
      case lower(coalesce(p.condition, 'lacrado'))
        when 'seminovo'  then 'seminovo'
        when 'semi novo' then 'seminovo'
        when 'vitrine'   then 'vitrine'
        else 'lacrado'
      end,
      round(p.price * 100)::bigint,
      greatest(p.stock_qty, 0),
      p.active
    from products p
    where p.name is not null and char_length(p.name) > 0
      and p.price >= 0
    returning 1
  )
  select (select count(*) from apagados) as apagados,
         (select count(*) from inseridos) as inseridos;
`;

async function main(): Promise<void> {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL ausente — rode com --env-file=.env --env-file=.env.local");

  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ apagados: string; inseridos: string }>(SQL_ESPELHAR, [ORG_ID]);
    const r = rows[0];
    if (!r || Number(r.inseridos) === 0) {
      // Zero inseridos com `products` cheia significa filtro errado ou org errada.
      // Commitar isso deixaria a loja SEM catálogo — o estado que este script veio consertar.
      throw new Error(`espelho vazio (apagados=${r?.apagados ?? "?"}) — nada commitado`);
    }
    await client.query("commit");
    console.log(`catálogo espelhado: ${r.inseridos} produtos (removidos ${r.apagados} do espelho anterior)`);

    const { rows: resumo } = await client.query<{ category: string; condition: string; n: string }>(
      `select category, condition, count(*)::text as n
         from store_products where organization_id = $1
        group by category, condition order by count(*) desc`,
      [ORG_ID],
    );
    for (const a of resumo) console.log(`  ${a.category} / ${a.condition}: ${a.n}`);
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
