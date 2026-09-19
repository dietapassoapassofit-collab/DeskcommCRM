"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

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
import { usePermission } from "@/hooks/auth/AuthProvider";
import {
  followupDoContatoQueryKey,
  useColocarNoFollowup,
  useFollowupDoContato,
} from "@/hooks/followup/useFollowupEnrollment";
import { useFollowupFlow } from "@/hooks/followup/useFollowupFlow";
import { useFollowupFlows } from "@/hooks/followup/useFollowupFlows";
import { useCancelFollowupEnrollment } from "@/hooks/followup/useFollowupQueue";
import { agendaDoFluxo, quemEscreve } from "@/lib/followup/agenda-do-fluxo";

interface Props {
  contactId: string | null;
}

function quando(aposMs: number | null): string {
  if (aposMs === null) return "a IA decide";
  if (aposMs === 0) return "agora";
  const horas = Math.floor(aposMs / 3_600_000);
  const minutos = Math.round((aposMs % 3_600_000) / 60_000);
  if (horas === 0) return `em ${minutos} min`;
  return minutos === 0 ? `em ${horas} h` : `em ${horas} h ${minutos} min`;
}

function AgendaDoFluxo({ pointerId }: { pointerId: string }) {
  const fluxo = useFollowupFlow(pointerId);
  const graph = fluxo.data?.draft_graph ?? null;
  if (fluxo.isLoading) return <p className="text-sm text-muted-foreground">Carregando o fluxo...</p>;
  if (!graph) return null;
  const envios = agendaDoFluxo(graph);
  if (envios.length === 0) return <p className="text-sm text-muted-foreground">Este fluxo não envia mensagens.</p>;
  return (
    <ol className="grid gap-2" aria-label="Mensagens que serão enviadas">
      {envios.map((envio, i) => (
        <li key={i} className="grid grid-cols-[88px_1fr] items-baseline gap-3 text-sm">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{quando(envio.aposMs)}</span>
          <span>
            {i === envios.length - 1 && envios.length > 1 ? "Última mensagem" : `${i + 1}ª mensagem`}
            {envio.modo === "content" ? " — texto pronto" : " — escrita pela IA"}
          </span>
        </li>
      ))}
      <li className="pt-1 text-sm text-muted-foreground">{FRASE_DE_QUEM_ESCREVE[quemEscreve(envios) ?? "ia"]}</li>
    </ol>
  );
}

const FRASE_DE_QUEM_ESCREVE: Record<"pronto" | "ia" | "misto", string> = {
  pronto: "As mensagens saem exatamente como foram escritas no fluxo.",
  ia: "A IA escreve cada mensagem na hora de enviar, usando esta conversa e o catálogo.",
  misto: "Parte das mensagens sai como escrita no fluxo; as marcadas \"escrita pela IA\" são escritas na hora.",
};

export function FollowupButton({ contactId }: Props) {
  const podeUsar = usePermission("ai.followups.enroll");
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [pointerId, setPointerId] = useState<string>("");
  const atual = useFollowupDoContato(contactId, podeUsar);
  const fluxos = useFollowupFlows();
  const colocar = useColocarNoFollowup();
  const cancelar = useCancelFollowupEnrollment();

  if (!podeUsar || !contactId) return null;

  if (atual.data) {
    const enrollmentId = atual.data.id;
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={cancelar.isPending}
        onClick={() => {
          if (!confirm("Parar o follow-up deste lead? As mensagens que ainda não saíram são canceladas.")) return;
          cancelar.mutate(enrollmentId, {
            onSuccess: () => void qc.invalidateQueries({ queryKey: followupDoContatoQueryKey(contactId) }),
          });
        }}
      >
        {cancelar.isPending ? "Parando..." : "Parar follow-up"}
      </Button>
    );
  }

  const ativos = (fluxos.data ?? []).filter((f) => f.status === "active");
  const selecionado = pointerId || ativos[0]?.id || "";

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setAberto(true)}>
        Follow-up
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Colocar este lead no follow-up?</DialogTitle>
            <DialogDescription>Escolha o fluxo e confira o que vai ser enviado.</DialogDescription>
          </DialogHeader>

          {ativos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum fluxo ativo. Publique um fluxo em Follow-ups para usar este botão.
            </p>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="followup-fluxo">Fluxo</Label>
                <Select value={selecionado} onValueChange={setPointerId}>
                  <SelectTrigger id="followup-fluxo">
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
              </div>
              {selecionado && <AgendaDoFluxo pointerId={selecionado} />}
              <p className="rounded-md border p-3 text-sm">
                Envia de verdade na conversa do cliente (WhatsApp ou Instagram), mesmo com o agente de IA desligado. Se o lead estiver em
                atendimento humano, ele é liberado só para o follow-up — quem atende continua na conversa.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!selecionado || colocar.isPending}
              onClick={() =>
                colocar.mutate(
                  { pointer_id: selecionado, contact_id: contactId },
                  { onSuccess: () => setAberto(false) },
                )
              }
            >
              {colocar.isPending ? "Colocando..." : "Colocar no follow-up"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
