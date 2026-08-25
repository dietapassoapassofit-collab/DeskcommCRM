/**
 * Capacidades de CATÁLOGO PRÓPRIO — específicas do negócio da Galega Imports
 * (loja de celulares/acessórios). Não usa `nuvemshop_products`: ver o motivo
 * na migration `0169_catalogo_proprio_galega.sql`.
 */
import { declararTools } from "./tipos";

export const TOOLS_PRODUTOS_GALEGA = declararTools([
  {
    name: "buscar_produto",
    category: "read",
    rotulo: "Buscar produto no catálogo da loja",
    explicacao:
      "Procura um produto pelo nome no catálogo próprio da loja e devolve categoria, condição (lacrado/seminovo/vitrine), preço e estoque reais, para o assistente não inventar preço nem confirmar estoque de cabeça.",
    oQueToca: "Catálogo próprio da loja",
    risco: "seguro",
    pacotes: ["vender", "atender"],
  },
  {
    name: "calcular_parcelamento",
    category: "read",
    rotulo: "Calcular parcelamento no cartão",
    explicacao:
      "Calcula o valor de cada parcela e o total com juros, usando a tabela de taxa real da maquininha por número de parcelas, para o assistente nunca calcular parcela de cabeça.",
    oQueToca: "Tabela de taxas de parcelamento",
    risco: "seguro",
    pacotes: ["vender"],
  },
]);
