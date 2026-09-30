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
import { ValorDaVendaDialog } from "@/components/kanban/ValorDaVendaDialog";
import { apiClient } from "@/lib/api/client";
import { useEtapasDoFunil } from "@/hooks/pipelines/useEtapasDoFunil";

interface Props {
  leadId: string;
  pipelineId: string | null;
  stageId: string | null;
  /** Nome do negócio, para o diálogo do valor dizer de qual venda se trata. */
  titulo: string;
  /** Valor já registrado. Com valor em mãos, o diálogo não aparece de novo. */
  valueCents: number | null;
  /** Recarrega o painel: a etapa nova precisa aparecer aqui, não só no quadro. */
  aoMover: () => void;
}

/** Fim da coluna, mesma convenção da ação em massa do quadro. */
const POSICAO_NO_FIM = 1_000_000;

export function EtapaDoLead({ leadId, pipelineId, stageId, titulo, valueCents, aoMover }: Props) {
  const etapas = useEtapasDoFunil(pipelineId);
  const [salvando, setSalvando] = useState(false);
  // Etapa de ganho escolhida aqui do chat, esperando o valor da venda.
  const [vendaPendente, setVendaPendente] = useState<string | null>(null);

  if (!pipelineId || !etapas.data || etapas.data.length === 0) return null;

  async function mover(novaEtapa: string, valorDaVenda?: number) {
    setSalvando(true);
    try {
      // O valor entra ANTES da mudança de etapa: é a mudança de etapa que
      // dispara a conversão para o Meta, e ela precisa achar o valor gravado.
      if (valorDaVenda !== undefined) {
        await apiClient.patch(`/api/v1/leads/${leadId}`, { value_cents: valorDaVenda });
      }
      await apiClient.post(`/api/v1/leads/${leadId}/move`, {
        stage_id: novaEtapa,
        position_in_stage: POSICAO_NO_FIM,
        // A guarda é a etapa que este painel está mostrando: só recusa se
        // alguém JÁ tiver movido o negócio.
        expected_stage_id: stageId,
      });
      aoMover();
    } catch (err) {
      showApiError(err);
    } finally {
      setSalvando(false);
    }
  }

  function escolher(novaEtapa: string) {
    if (novaEtapa === stageId) return;
    // Venda fechada daqui do chat pede o valor do mesmo jeito que pelo quadro:
    // o vendedor que atende pelo Inbox não abre o funil para registrar isso, e
    // sem o valor a venda vai para o Meta sem faturamento.
    const etapa = etapas.data?.find((e) => e.id === novaEtapa);
    if (etapa?.is_won && !valueCents) {
      setVendaPendente(novaEtapa);
      return;
    }
    void mover(novaEtapa);
  }

  return (
    <>
      <Select value={stageId ?? undefined} disabled={salvando} onValueChange={escolher}>
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

      {vendaPendente && (
        <ValorDaVendaDialog
          aberto
          nomeDoNegocio={titulo}
          onCancelar={() => setVendaPendente(null)}
          onPular={() => {
            const etapa = vendaPendente;
            setVendaPendente(null);
            void mover(etapa);
          }}
          onConfirmar={(valor) => {
            const etapa = vendaPendente;
            setVendaPendente(null);
            void mover(etapa, valor);
          }}
        />
      )}
    </>
  );
}
