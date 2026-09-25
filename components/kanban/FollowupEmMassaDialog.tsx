"use client";

import { useState } from "react";
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

/**
 * Minutos entre um lead e o próximo. Os envios de um fluxo são parecidos por
 * construção (é o mesmo texto em 3 versões), e a trava de repetição olha as
 * últimas 20 mensagens do número: sair tudo junto faria a terceira ser vetada.
 * Seis minutos espalham um lote de 25 por ~2h30, dentro do horário de envio.
 */
const INTERVALO_MIN = 6;

/** Teto por lote. Acima disso a conta vira disparo em massa de verdade, que pede
 *  conversa antes — não um clique a mais. */
const MAX_POR_LOTE = 25;

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

  const doLote = contatos.slice(0, MAX_POR_LOTE);
  const sobra = contatos.length - doLote.length;
  const ultimoEm = doLote.length > 1 ? (doLote.length - 1) * INTERVALO_MIN : 0;

  const colocar = async () => {
    if (!fluxo || doLote.length === 0) return;
    setRodando(true);
    setFeitos(0);
    let ok = 0;
    let jaEmFluxo = 0;
    let falhou = 0;
    // Uma chamada por lead, em série: a rota é por contato e o lote é pequeno.
    // Em série também evita a corrida do índice "um follow-up vivo por contato".
    for (const [i, contactId] of doLote.entries()) {
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
    if (sobra > 0) partes.push(`${sobra} ficou de fora do lote`);
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
              {doLote.length} lead{doLote.length === 1 ? "" : "s"} neste lote
              {ultimoEm > 0 ? ` — o último recebe em cerca de ${Math.round(ultimoEm / 60)}h${ultimoEm % 60 ? ` ${ultimoEm % 60}min` : ""}` : ""}.
            </p>
            {sobra > 0 && (
              <p className="mt-1 text-text-muted">
                {sobra} selecionado{sobra === 1 ? "" : "s"} ficam de fora: o lote vai até {MAX_POR_LOTE}.
                Repita amanhã com o resto.
              </p>
            )}
            {semContato > 0 && (
              <p className="mt-1 text-text-muted">
                {semContato} selecionado{semContato === 1 ? "" : "s"} sem contato ligado — esses não recebem.
              </p>
            )}
            <p className="mt-1 text-text-muted">
              Quem já estiver em outro follow-up é pulado, e o Instagram só recebe quem falou nas últimas 24h.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={rodando}>
            Cancelar
          </Button>
          <Button onClick={colocar} disabled={!fluxo || rodando || doLote.length === 0}>
            {rodando ? `Colocando… ${feitos}/${doLote.length}` : `Colocar ${doLote.length} no follow-up`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
