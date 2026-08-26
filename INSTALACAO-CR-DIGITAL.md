# Instalação CR Digital — o que é específico daqui

Notas da instalação que a CR Digital opera (cliente piloto: Galega Imports).
Nada aqui é do produto DeskcommCRM: é o que muda por esta máquina hospedar
**dois sistemas diferentes**.

## O banco é COMPARTILHADO com o bot interno da CR Digital

O projeto Supabase `vgcoyvphfucppmttigzg` atende dois sistemas:

1. **Este CRM** (`~/trabalho/deskcomm-galega`, Docker)
2. **O bot de WhatsApp interno da CR Digital** (`~/trabalho/cr-digital-whatsapp`,
   systemd `cr-digital-whatsapp`) — o gerente de SDR que fala com o time

Os dados não se misturam: são conjuntos de tabelas disjuntos. O risco é de
schema, e ele já se materializou uma vez.

### Tabelas do bot da CR — NÃO TOQUE

```
agent_feedback
client_observations
legacy_conversations
notifications_log
whatsapp_label_associations
whatsapp_labels
```

Uma migration deste CRM que crie, renomeie ou altere qualquer uma delas quebra
o bot da CR, e a quebra é silenciosa do lado de cá: os testes daqui passam, o
CRM sobe, e quem descobre é o time da CR quando o bot para de responder.

**Já aconteceu:** o CRM passou a ter uma tabela `conversations` própria e o bot
da CR, que lia de uma `conversations` sua, começou a falhar com erro de coluna
inexistente. A correção foi renomear a do bot para `legacy_conversations` —
por isso o nome. Se aparecer um segundo caso, prefira renomear do lado do bot
outra vez a apertar o CRM: o CRM é o produto, o bot é o inquilino.

### Antes de aplicar migration aqui

Rode isto e confira que nenhuma das seis aparece:

```bash
grep -oE '(create|alter|drop)\s+(table|view)\s+[a-z_.]+' supabase/migrations/<nova>.sql
```

## O chip do WhatsApp

Hoje o agente da Galega e o bot da CR dividem o **558195285018**. O WhatsApp
entrega toda mensagem aos dois aparelhos vinculados, então os dois enxergam
tudo que chega.

Enquanto for assim, `WHATSAPP_TEST_ONLY_PHONE` fica ligado no `.env`: sem ele,
o agente da loja responde a colega da CR que escrever no número, e o histórico
do bot interno (relatório de Meta Ads, aviso de deploy) entra na janela de
contexto do agente como se fosse conversa de venda. Os dois já aconteceram.

O gate mora em `lib/waha/ingest.ts` (`foraDoChatDeTeste`) e vale nos dois
sentidos — inbound e `fromMe`. É **allowlist**: passa só o número de teste,
descarta o resto, inclusive chat `@lid` sem telefone no payload. Escrito como
denylist ele não barrava ninguém, porque na engine NOWEB todo chat chega como
`<digitos>@lid` e a comparação por telefone nunca era verdadeira.

Quando a Galega tiver número próprio (Fase 4), remova a env var e o gate junto.

## Serviços nesta VPS

| serviço | como roda | onde |
|---|---|---|
| CRM (app, worker, waha, redis, srh, scheduler, caddy) | `docker-compose.prod.yml` | `~/trabalho/deskcomm-galega` |
| Bot interno da CR | systemd `cr-digital-whatsapp` | `~/trabalho/cr-digital-whatsapp` |

Parar um não afeta o outro, exceto pelo chip compartilhado descrito acima.

## Catálogo da loja

`store_products` é espelho do ERP Softcom, que **não tem API**. A carga vem de
dois relatórios exportados em `.xls` (`scripts/importar-softcom.py`).

O script avisa quando o export para de chegar, por idade do arquivo e por hash
do conteúdo. O aviso existe porque o catálogo já passou 21 dias congelado com o
agente cotando preço velho, e nada percebeu.
