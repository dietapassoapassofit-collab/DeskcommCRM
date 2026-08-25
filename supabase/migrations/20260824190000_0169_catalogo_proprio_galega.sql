-- 0169 — catálogo de produtos próprio da Galega Imports + tabela de taxas de parcelamento
--
-- Não reaproveita `nuvemshop_products`: aquela tabela é a integração com a
-- plataforma Nuvemshop e não tem coluna de condição (lacrado/seminovo/vitrine),
-- que é o cerne da conversa de venda deste negócio — perder essa informação
-- faria o agente responder preço sem saber qual dos dois ele está cotando.

CREATE TABLE IF NOT EXISTS "public"."store_products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
    "sku" "text",
    "name" "text" NOT NULL,
    "category" "text" NOT NULL,
    "condition" "text" NOT NULL,
    "price_cents" bigint NOT NULL,
    "stock_qty" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "store_products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "store_products_price_cents_check" CHECK (("price_cents" >= 0)),
    CONSTRAINT "store_products_stock_qty_check" CHECK (("stock_qty" >= 0)),
    CONSTRAINT "store_products_name_check" CHECK ((char_length("name") > 0)),
    CONSTRAINT "store_products_condition_check" CHECK (("condition" = ANY (ARRAY['lacrado'::"text", 'seminovo'::"text", 'vitrine'::"text"])))
);

ALTER TABLE "public"."store_products" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "store_products_org_name_idx"
    ON "public"."store_products" USING btree ("organization_id", "name")
    WHERE ("active" = true);

ALTER TABLE "public"."store_products" ENABLE ROW LEVEL SECURITY;

DO $baseline_guard$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policy
                WHERE polname = 'store_products_tenant' AND polrelid = '"public"."store_products"'::regclass) THEN
CREATE POLICY "store_products_tenant" ON "public"."store_products" USING ((("organization_id" IN ( SELECT "public"."fn_user_org_ids"() AS "fn_user_org_ids")) OR "public"."fn_is_platform_admin"())) WITH CHECK ((("organization_id" IN ( SELECT "public"."fn_user_org_ids"() AS "fn_user_org_ids")) OR "public"."fn_is_platform_admin"()));
END IF; END $baseline_guard$;


CREATE TABLE IF NOT EXISTS "public"."installment_fee_rates" (
    "organization_id" "uuid" NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
    "installments" smallint NOT NULL,
    "fee_percent" numeric(6,3) NOT NULL,
    CONSTRAINT "installment_fee_rates_pkey" PRIMARY KEY ("organization_id", "installments"),
    CONSTRAINT "installment_fee_rates_installments_check" CHECK (("installments" BETWEEN 1 AND 18))
);

ALTER TABLE "public"."installment_fee_rates" OWNER TO "postgres";

ALTER TABLE "public"."installment_fee_rates" ENABLE ROW LEVEL SECURITY;

DO $baseline_guard$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policy
                WHERE polname = 'installment_fee_rates_tenant' AND polrelid = '"public"."installment_fee_rates"'::regclass) THEN
CREATE POLICY "installment_fee_rates_tenant" ON "public"."installment_fee_rates" USING ((("organization_id" IN ( SELECT "public"."fn_user_org_ids"() AS "fn_user_org_ids")) OR "public"."fn_is_platform_admin"())) WITH CHECK ((("organization_id" IN ( SELECT "public"."fn_user_org_ids"() AS "fn_user_org_ids")) OR "public"."fn_is_platform_admin"()));
END IF; END $baseline_guard$;
