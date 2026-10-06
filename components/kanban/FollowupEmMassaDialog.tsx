"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { useFollowupFlows } from "@/hooks/followup/useFollowupFlows";
import { TEXTO_DO_MOTIVO, type Previa } from "@/lib/followup/previa-do-disparo";

/**
 * Minutos entre um lead e o próximo (3 min = 180s, escolha do lojista). Os
 * envios de um fluxo são parecidos por construção (o mesmo texto em 3 versões),
 * e a trava de repetição olha as últimas 20 mensagens do número: sair tudo junto
 * faria a terceira ser vetada. O espaçamento é o que deixa a coluna inteira
 * receber.
 */
const INTERVALO_MIN = 3;

/** Fim do horário de envio (o motor segura o que passar disso para a manhã seguinte). */
const FIM_DO_HORARIO = 22;

export function FollowupEmMassaDialog({
  aberto,
  onOpenChange,
  contatos,
  semContato,
  onConcluido,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  /** contact_id dos leads selecionados, sem repetição. */
  contatos: string[];
  /** Quantos selecionados não têm contato — não dá para enviar, e o usuário precisa saber. */
  semContato: number;
  onConcluido: () => void;
}) {
  const flows = useFollowupFlows();
  const ativos = (flows.data ?? []).filter((f) => f.status === "active");
  const [fluxo, setFluxo] = useState<string>("");
  const [rodando, setRodando] = useState(false);
  const [feitos, setFeitos] = useState(0);
  // `ref` e não estado: o laço em andamento precisa enxergar o pedido de parada
  // na iteração seguinte, e um estado só chegaria no próximo render.
  const pararRef = useRef(false);
  const [abertoEm, setAbertoEm] = useState<number | null>(null);
  useEffect(() => {
    setAbertoEm(aberto ? Date.now() : null);
  }, [aberto]);

  // QUEM PODE RECEBER, ANTES DE INSCREVER NINGUÉM.
  //
  // Sem isto o lote inscrevia todo mundo e descobria depois: medido em 14 dias,
  // 31 contatos do Instagram ocupavam vaga, gastavam os 3 minutos de
  // espaçamento de cada um e morriam no fim da fila por estarem fora das 24h.
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);
  useEffect(() => {
    if (!aberto || contatos.length === 0) {
      setPrevia(null);
      return;
    }
    let vivo = true;
    setCarregandoPrevia(true);
    apiClient
      .post<{ data: Previa }>("/api/v1/ai/followups/enrollments/previa", { contact_ids: contatos })
      .then((r) => {
        if (vivo) setPrevia(r.data);
      })
      .catch(() => {
        // Prévia é conforto, não porteiro: se ela falhar, o disparo segue com a
        // lista inteira e o motor continua barrando quem não pode.
        if (vivo) setPrevia(null);
      })
      .finally(() => {
        if (vivo) setCarregandoPrevia(false);
      });
    return () => {
      vivo = false;
    };
  }, [aberto, contatos]);

  // Sem teto: quem decide o tamanho do lote é o lojista, e o que protege o
  // número é o espaçamento, não um limite arbitrário. O que ele precisa ver
  // ANTES de confirmar é quando a última mensagem sai.
  const doLote = previa ? previa.aptos : contatos;
  const foraDoLote = previa ? previa.fora.length : 0;
  const ultimoEm = doLote.length > 1 ? (doLote.length - 1) * INTERVALO_MIN : 0;
  // O relógio é lido ao ABRIR, não a cada render: ler a hora durante o render
  // é impuro (e o compilador do React reprova), e o número na tela ficaria
  // dançando enquanto a pessoa escolhe o fluxo.
  const fim = abertoEm === null ? null : new Date(abertoEm + ultimoEm * 60_000);
  const passaDoHorario = fim !== null && fim.getHours() >= FIM_DO_HORARIO;

  const colocar = async () => {
    if (!fluxo || doLote.length === 0) return;
    pararRef.current = false;
    setRodando(true);
    setFeitos(0);
    let ok = 0;
    let jaEmFluxo = 0;
    let falhou = 0;
    // Uma chamada por lead, em série: a rota é por contato e o lote é pequeno.
    // Em série também evita a corrida do índice "um follow-up vivo por contato".
    for (const [i, contactId] of doLote.entries()) {
      if (pararRef.current) break;
      try {
        await apiClient.post("/api/v1/ai/followups/enrollments", {
          pointer_id: fluxo,
          contact_id: contactId,
          release_handoff: true,
          start_in_minutes: i * INTERVALO_MIN,
        });
        ok += 1;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) jaEmFluxo += 1;
        else falhou += 1;
      }
      setFeitos(i + 1);
    }
    setRodando(false);
    onOpenChange(false);
    const partes = [`${ok} no follow-up`];
    if (jaEmFluxo > 0) partes.push(`${jaEmFluxo} já estava${jaEmFluxo > 1 ? "m" : ""} em outro fluxo`);
    if (falhou > 0) partes.push(`${falhou} falhou${falhou > 1 ? "ram" : ""}`);
    if (pararRef.current) partes.push("parado por você");
    if (ok > 0) toast.success(partes.join(" · "));
    else toast.error(partes.join(" · "));
    onConcluido();
  };

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Colocar no follow-up</DialogTitle>
          <DialogDescription>
            As mensagens saem espaçadas, {INTERVALO_MIN} minutos entre um cliente e o próximo, para o
            número da loja não cair na trava de mensagem repetida.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fluxo-massa">Fluxo</Label>
            {flows.isLoading ? (
              <p className="text-sm text-text-muted">Carregando os fluxos…</p>
            ) : ativos.length === 0 ? (
              <p className="text-sm text-text-muted">
                Nenhum fluxo publicado. Publique um em IA → Follow-ups primeiro.
              </p>
            ) : (
              <Select value={fluxo} onValueChange={setFluxo}>
                <SelectTrigger id="fluxo-massa">
                  <SelectValue placeholder="Escolha o fluxo" />
                </SelectTrigger>
                <SelectContent>
                  {ativos.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="rounded-md border border-border p-3 text-sm">
            <p>
              {doLote.length} lead{doLote.length === 1 ? "" : "s"} neste lote, um a cada {INTERVALO_MIN} minutos
              {ultimoEm > 0 && fim !== null
                ? ` — o último recebe por volta das ${fim.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                : ""}
              .
            </p>
            {passaDoHorario && (
              <p className="mt-1 text-text-muted">
                Passa das {FIM_DO_HORARIO}h: quem sobrar recebe na manhã seguinte, a partir das 7h.
              </p>
            )}
            {foraDoLote > 0 && previa && (
              <p className="mt-1 text-text-muted">
                {foraDoLote} de {contatos.length} ficam de fora:{" "}
                {Object.entries(previa.resumo)
                  .sort((a, b) => b[1] - a[1])
                  .map(([motivo, n]) => `${n} ${TEXTO_DO_MOTIVO[motivo as keyof typeof TEXTO_DO_MOTIVO]}`)
                  .join(", ")}
                .
              </p>
            )}
            {semContato > 0 && (
              <p className="mt-1 text-text-muted">
                {semContato} selecionado{semContato === 1 ? "" : "s"} sem contato ligado — esses não recebem.
              </p>
            )}
            <p className="mt-1 text-text-muted">
              Quem já estiver em outro follow-up é pulado, e o Instagram só recebe quem falou nas últimas 24h.
              Depois de começar, dá para pausar e retomar o disparo em IA → Follow-ups → Fila.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => (rodando ? (pararRef.current = true) : onOpenChange(false))}
          >
            {rodando ? "Parar" : "Cancelar"}
          </Button>
          <Button onClick={colocar} disabled={!fluxo || rodando || carregandoPrevia || doLote.length === 0}>
            {rodando
              ? `Colocando… ${feitos}/${doLote.length}`
              : carregandoPrevia
                ? "Conferindo quem pode receber…"
                : `Colocar ${doLote.length} no follow-up`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
