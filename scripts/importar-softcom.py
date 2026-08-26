#!/usr/bin/env python3
"""
Espelha o catálogo do Softcom (ERP da loja) em `store_products`, que é a tabela
que a tool `buscar_produto` lê.

POR QUE ARQUIVO E NÃO API: a Softcom não publica API. O que o ERP oferece é
exportação de relatório, e é dela que saem os dois .xls que este script lê:

  Relatórios → Exibir Estoque → Conferência de Estoque   (quantidade)
  Relatórios → Exibir Estoque → Tabela de Preços Agrupado (preço)

Junta pelo "Código da Mercadoria", que vira o `sku`.

O AVISO É A PARTE QUE IMPORTA. Importar planilha já era possível antes deste
script — e mesmo assim o catálogo passou 21 dias congelado, com o agente cotando
preço velho e ninguém percebendo, porque nada avisava. Arquivo parado há mais de
LIMITE_HORAS faz este script sair com código 2, alto e visível, DEPOIS de
importar: dado velho continua melhor que tabela vazia, mas não pode ser
silencioso.

Uso:
  python3 importar-softcom.py <pasta-com-os-xls>
  ORG_ID=<uuid> python3 importar-softcom.py /caminho/catalogo
"""
import hashlib
import json
import os
import sys
import time
import urllib.request

import xlrd

ORG = os.environ.get("ORG_ID", "10e5e6fd-21e9-4fd1-bb80-921d273d53d3")
LIMITE_HORAS = 48
ARQ_ESTOQUE = "Relatorios_ExibirEstoque_ConferenciaEstoque.xls"
ARQ_PRECOS = "Relatorios_ExibirEstoque_TabelaPrecosAgrupado.xls"

# VendaA = varejo. VendaB e VendaC são atacado e não podem vazar para o cliente
# final: o agente atende varejo, e citar preço de atacado é prometer o que a
# loja não vai honrar.
COL_PRECO_VAREJO = 4


def condicao(nome):
    """Só o nome carrega a condição — o ERP não tem coluna para isso.

    Sem marca vira 'lacrado' por decisão do dono da loja: são 78 dos 105
    aparelhos, quase todos importados novos. Aparelho que for seminovo se
    corrige no painel, e a correção sobrevive ao próximo import porque o
    UPDATE só toca preço e estoque.
    """
    u = nome.upper()
    if "SEMINOVO" in u or "SEMI NOVO" in u:
        return "seminovo"
    if "VITRINE" in u:
        return "vitrine"
    return "lacrado"


def ler_planilha(caminho, col_nome, col_valor):
    """Devolve {codigo: (nome, valor)}. Linha sem código ou sem nome é ignorada."""
    wb = xlrd.open_workbook(caminho)
    sh = wb.sheet_by_index(0)
    out = {}
    for r in range(1, sh.nrows):
        bruto = str(sh.cell_value(r, 0)).strip()
        if not bruto:
            continue
        codigo = bruto[:-2] if bruto.endswith(".0") else bruto
        nome = str(sh.cell_value(r, col_nome)).strip()
        if not codigo or not nome:
            continue
        try:
            valor = float(sh.cell_value(r, col_valor))
        except (ValueError, TypeError):
            continue
        out[codigo] = (nome, valor)
    return out


def idade_horas(caminho):
    return (time.time() - os.path.getmtime(caminho)) / 3600.0


def sha(caminho):
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        for bloco in iter(lambda: f.read(65536), b""):
            h.update(bloco)
    return h.hexdigest()


def conteudo_repetido(pasta, hashes):
    """True se os arquivos são BYTE A BYTE os da importação anterior.

    A data do arquivo é frágil: `scp` sem `-p`, anexo de e-mail e download de
    WhatsApp reescrevem o mtime, e um export de três semanas atrás chega
    parecendo novinho. O conteúdo não mente — se o sha256 é o mesmo, ninguém
    exportou nada desde a última vez, por mais recente que a data pareça.
    """
    marca = os.path.join(pasta, ".ultima-importacao.json")
    anterior = None
    if os.path.exists(marca):
        try:
            with open(marca, encoding="utf-8") as f:
                anterior = json.load(f)
        except (ValueError, OSError):
            anterior = None
    with open(marca, "w", encoding="utf-8") as f:
        json.dump(hashes, f)
    return anterior == hashes


def rest(metodo, caminho, corpo=None, prefer=None):
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/") + "/rest/v1/" + caminho
    chave = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    dados = json.dumps(corpo).encode() if corpo is not None else None
    req = urllib.request.Request(url, data=dados, method=metodo)
    req.add_header("apikey", chave)
    req.add_header("Authorization", "Bearer " + chave)
    req.add_header("Content-Type", "application/json")
    if prefer:
        req.add_header("Prefer", prefer)
    with urllib.request.urlopen(req, timeout=120) as r:
        txt = r.read().decode()
        return json.loads(txt) if txt.strip() else None


def main():
    pasta = sys.argv[1] if len(sys.argv) > 1 else "."
    p_estoque = os.path.join(pasta, ARQ_ESTOQUE)
    p_precos = os.path.join(pasta, ARQ_PRECOS)

    for p in (p_estoque, p_precos):
        if not os.path.exists(p):
            print("ERRO: nao encontrei %s" % p, file=sys.stderr)
            return 1

    velhos = [(os.path.basename(p), idade_horas(p)) for p in (p_estoque, p_precos)]
    desatualizado = [(n, h) for n, h in velhos if h > LIMITE_HORAS]
    repetido = conteudo_repetido(pasta, {os.path.basename(p): sha(p) for p in (p_estoque, p_precos)})

    estoque = ler_planilha(p_estoque, col_nome=3, col_valor=5)
    precos = ler_planilha(p_precos, col_nome=1, col_valor=COL_PRECO_VAREJO)

    linhas = []
    sem_preco = 0
    for codigo, (nome, qtd) in estoque.items():
        if codigo not in precos:
            # Produto sem preço não pode ser cotado. Deixá-lo entrar com preço 0
            # faria o agente oferecer aparelho de graça.
            sem_preco += 1
            continue
        preco = precos[codigo][1]
        if preco <= 0:
            sem_preco += 1
            continue
        eh_aparelho = nome.upper().startswith("APARELHO")
        linhas.append({
            "organization_id": ORG,
            "sku": codigo,
            "name": nome,
            "category": "Aparelho" if eh_aparelho else "Acessório",
            "condition": condicao(nome) if eh_aparelho else "lacrado",
            "price_cents": int(round(preco * 100)),
            "stock_qty": max(int(qtd), 0),
            "active": True,
        })

    if not linhas:
        # Espelho vazio é o estado que este script existe para evitar: a tool
        # responderia "não tem" para tudo, com a autoridade de quem consultou.
        print("ERRO: nenhuma linha para importar — nada foi alterado", file=sys.stderr)
        return 1

    rest("DELETE", "store_products?organization_id=eq.%s" % ORG)
    for i in range(0, len(linhas), 500):
        rest("POST", "store_products", linhas[i:i + 500], prefer="return=minimal")

    aparelhos = sum(1 for l in linhas if l["category"] == "Aparelho")
    print("catalogo espelhado: %d produtos (%d aparelhos, %d acessorios)"
          % (len(linhas), aparelhos, len(linhas) - aparelhos))
    if sem_preco:
        print("  %d ignorados por nao terem preco de varejo" % sem_preco)

    if repetido or desatualizado:
        print("", file=sys.stderr)
        print("ATENCAO: export do Softcom parado — o agente esta cotando preco velho.", file=sys.stderr)
        if repetido:
            print("  os arquivos sao IDENTICOS aos da importacao anterior", file=sys.stderr)
        for n, h in desatualizado:
            print("  %s: %.0f horas sem atualizar" % (n, h), file=sys.stderr)
        print("Exporte de novo em Relatorios > Exibir Estoque no Softcom.", file=sys.stderr)
        return 2

    for n, h in velhos:
        print("  %s: %.0fh" % (n, h))
    return 0


if __name__ == "__main__":
    sys.exit(main())
