"""
Importa o histórico do Instagram Direct (via Zernio) para o CRM.

Cada mensagem antiga vira um evento `message.received` ASSINADO com o segredo
do webhook da sessão e marcado `historico: true`, e entra pelo MESMO webhook
das mensagens novas — mesma identidade, mesma thread, mesma idempotência
(rodar de novo não duplica). O modo histórico grava sem criar lead, sem
acordar o agente e sem disparar automação (ver `lib/channels/zernio/ingest.ts`).

Uso (na VPS, com o .env carregado):
  ZERNIO_IMPORT_API_KEY=... ZERNIO_IMPORT_WEBHOOK_SECRET=... \
  python3 scripts/importar-historico-instagram.py <accountId> <urlDoWebhook> [--dias N]

Ao final zera o contador de não lidas das conversas importadas: histórico não
é mensagem nova para o atendente.
"""
import argparse
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = os.environ.get("ZERNIO_API_BASE_URL", "https://zernio.com/api")
CHAVE = os.environ["ZERNIO_IMPORT_API_KEY"]
SEGREDO = os.environ["ZERNIO_IMPORT_WEBHOOK_SECRET"]
SUPA = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPA_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]


def zernio(caminho, tentativas=4):
    for i in range(tentativas):
        req = urllib.request.Request(BASE + caminho, headers={"Authorization": f"Bearer {CHAVE}"})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode())
        except (urllib.error.URLError, TimeoutError) as e:
            if i == tentativas - 1:
                raise
            time.sleep(3 * (i + 1))


def paginas(caminho, chave_lista):
    cursor = None
    while True:
        sep = "&" if "?" in caminho else "?"
        extra = f"{sep}limit=100" + (f"&cursor={urllib.parse.quote(cursor)}" if cursor else "")
        pagina = zernio(caminho + extra)
        yield from pagina.get(chave_lista) or []
        pag = pagina.get("pagination") or {}
        cursor = pag.get("nextCursor")
        if not pag.get("hasMore") or not cursor:
            return


def enviar(url, evento):
    corpo = json.dumps(evento, ensure_ascii=False).encode()
    assinatura = hmac.new(SEGREDO.encode(), corpo, hashlib.sha256).hexdigest()
    req = urllib.request.Request(url, data=corpo, method="POST", headers={
        "Content-Type": "application/json", "x-zernio-signature": assinatura,
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, {"erro": e.read().decode()[:200]}


def achar(obj, chave):
    """Primeiro valor de `chave` em qualquer nível — o corpo da rota é embrulhado."""
    if isinstance(obj, dict):
        if isinstance(obj.get(chave), str):
            return obj[chave]
        for v in obj.values():
            r = achar(v, chave)
            if r:
                return r
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("account_id")
    ap.add_argument("webhook_url")
    ap.add_argument("--dias", type=int, default=0, help="só conversas ativas nos últimos N dias (0 = todas)")
    a = ap.parse_args()
    corte = datetime.now(timezone.utc) - timedelta(days=a.dias) if a.dias else None

    contagem, conversas_crm, n_conv = {}, set(), 0
    for conv in paginas(f"/v1/inbox/conversations?accountId={a.account_id}", "data"):
        if conv.get("platform") != "instagram":
            continue
        if corte and datetime.fromisoformat(conv["updatedTime"].replace("Z", "+00:00")) < corte:
            continue
        n_conv += 1
        participante = {
            "participantId": conv.get("participantId"),
            "participantName": conv.get("participantName"),
            "participantUsername": conv.get("participantUsername"),
        }
        caminho = f"/v1/inbox/conversations/{urllib.parse.quote(conv['id'])}/messages?accountId={a.account_id}&sortOrder=asc"
        for m in paginas(caminho, "messages"):
            anexos = [x for x in (m.get("attachments") or []) if isinstance(x, dict) and x.get("url")]
            if m.get("isDeleted") or (not m.get("message") and not anexos):
                contagem["pulada_vazia"] = contagem.get("pulada_vazia", 0) + 1
                continue
            entrada = m.get("direction") == "incoming"
            evento = {
                "event": "message.received",
                "historico": True,
                "account": {"id": a.account_id},
                "conversation": participante,
                "message": {
                    "id": m["id"],
                    "conversationId": conv["id"],
                    "platform": "instagram",
                    "platformMessageId": m["id"],
                    "direction": m.get("direction"),
                    "text": m.get("message") or None,
                    "attachments": [{"type": x.get("type") or "file", "url": x["url"]} for x in anexos],
                    # O participante da conversa é a âncora estável; o `senderId`
                    # da API pode não ser o mesmo id que o webhook entrega.
                    "sender": (
                        {"id": conv.get("participantId"), "name": conv.get("participantName"),
                         "username": conv.get("participantUsername")}
                        if entrada else {"id": m.get("senderId"), "username": m.get("senderName")}
                    ),
                    "sentAt": m.get("sentAt") or m.get("createdAt"),
                },
            }
            st, corpo = enviar(a.webhook_url, evento)
            desfecho = achar(corpo, "status") if st == 200 else f"http_{st}"
            contagem[desfecho] = contagem.get(desfecho, 0) + 1
            if st != 200 and contagem[desfecho] <= 3:
                print("  falha:", st, corpo, file=sys.stderr)
            cid = achar(corpo, "conversationId")
            if cid:
                conversas_crm.add(cid)
            time.sleep(0.05)
        if n_conv % 20 == 0:
            print(f"{n_conv} conversas… {contagem}", flush=True)

    for cid in conversas_crm:
        req = urllib.request.Request(
            f"{SUPA}/rest/v1/conversations?id=eq.{cid}",
            data=json.dumps({"unread_count_for_assignee": 0}).encode(), method="PATCH",
            headers={"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}",
                     "Content-Type": "application/json", "Prefer": "return=minimal"},
        )
        urllib.request.urlopen(req, timeout=30).read()

    print(f"FIM: {n_conv} conversas do Instagram, {len(conversas_crm)} no CRM | {contagem}")


if __name__ == "__main__":
    main()
