"use client";
import { useMutation, useQuery } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { ApiError, type ApiErrorBody } from "@/lib/api/types";

export interface MidiaDoFluxo {
  storage_path: string;
  mime: string;
  media_kind: "image" | "video";
  size_bytes: number;
  filename: string;
}

const ROTA = "/api/v1/ai/followup-flows/media";

async function lerResposta<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as Partial<ApiErrorBody> & { data?: T };
  if (!res.ok || json.data === undefined) {
    const e = json.error;
    throw new ApiError(res.status, e?.code ?? "request_failed", e?.details, e?.request_id ?? "", e?.message);
  }
  return json.data;
}

/** Sobe a foto/vídeo de um bloco Conteúdo. */
export function useSubirMidiaDoFluxo() {
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file, file.name);
      return lerResposta<MidiaDoFluxo>(await fetch(ROTA, { method: "POST", body: form }));
    },
    onError: (err) => showApiError(err),
  });
}

/** Link temporário (1h) para a prévia no editor. Refaz antes de vencer. */
export function usePreviaDaMidia(storagePath: string | null) {
  return useQuery({
    queryKey: ["followup-media-preview", storagePath],
    enabled: storagePath !== null,
    staleTime: 50 * 60_000,
    queryFn: async () =>
      (await lerResposta<{ url: string }>(await fetch(`${ROTA}?path=${encodeURIComponent(storagePath ?? "")}`))).url,
  });
}
