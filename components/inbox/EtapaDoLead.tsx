"use client";
import { useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import { useEtapasDoFunil } from "@/hooks/pipelines/useEtapasDoFunil";

interface Props {
  leadId: string;
  pipelineId: string | null;
  stageId: string | null;
  /** `crm_leads.updated_at` — a rota recusa a troca se o lead mudou desde a leitura. */
  updatedAt: string;
  /** Recarrega o painel: a etapa nova precisa aparecer aqui, não só no quadro. */
  aoMover: () => void;
}

/** Fim da coluna, mesma convenção da ação em massa do quadro. */
const POSICAO_NO_FIM = 1_000_000;

export function EtapaDoLead({ leadId, pipelineId, stageId, updatedAt, aoMover }: Props) {
  const etapas = useEtapasDoFunil(pipelineId);
  const [salvando, setSalvando] = useState(false);

  if (!pipelineId || !etapas.data || etapas.data.length === 0) return null;

  async function mover(novaEtapa: string) {
    if (novaEtapa === stageId) return;
    setSalvando(true);
    try {
      await apiClient.post(`/api/v1/leads/${leadId}/move`, {
        stage_id: novaEtapa,
        position_in_stage: POSICAO_NO_FIM,
        expected_updated_at: updatedAt,
      });
      aoMover();
    } catch (err) {
      // Inclui o 409 de edição concorrente: a mensagem da rota manda recarregar,
      // e engolir isso deixaria a tela mostrando uma etapa que o banco não tem.
      showApiError(err);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Select value={stageId ?? undefined} disabled={salvando} onValueChange={(v) => void mover(v)}>
      <SelectTrigger className="h-7 w-[150px] text-xs" aria-label="Etapa do funil">
        <SelectValue placeholder={salvando ? "Movendo..." : "Escolha a etapa"} />
      </SelectTrigger>
      <SelectContent>
        {etapas.data.map((e) => (
          <SelectItem key={e.id} value={e.id} className="text-xs">
            {e.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
