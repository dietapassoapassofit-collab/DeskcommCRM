"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

export interface EtapaDoFunil {
  id: string;
  name: string;
  position: number;
  is_won: boolean;
  is_lost: boolean;
}

export const etapasDoFunilQueryKey = (pipelineId: string) => ["pipeline", "etapas", pipelineId] as const;

/** As colunas vivas de um funil, na ordem do quadro. Só busca com um funil em mãos. */
export function useEtapasDoFunil(pipelineId: string | null) {
  return useQuery({
    queryKey: etapasDoFunilQueryKey(pipelineId ?? ""),
    enabled: !!pipelineId,
    staleTime: 60_000,
    queryFn: async (): Promise<EtapaDoFunil[]> => {
      const res = await apiClient.get<{ data: { etapas: EtapaDoFunil[] } }>(
        `/api/v1/pipelines/${pipelineId}/stages`,
      );
      return res.data.etapas;
    },
  });
}
