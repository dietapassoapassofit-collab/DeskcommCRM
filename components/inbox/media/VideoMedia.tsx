"use client";
import { useState } from "react";

import { MediaUnavailable } from "./MediaUnavailable";
import { mediaSrc } from "./media-utils";

/** Vídeo inline com controles nativos (padrão WhatsApp Web). */
export function VideoMedia({ messageId }: { messageId: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="relative w-full max-w-sm aspect-video overflow-hidden rounded-lg bg-black/5">
      {failed ? (
        <MediaUnavailable kind="Vídeo" className="h-full w-full" />
      ) : (
        /*
          ⚠️ `preload="none"` e SEM esqueleto de carregamento, e os dois andam
          juntos.

          Com `preload="metadata"`, TODO vídeo da thread buscava o arquivo assim
          que a bolha renderizava: medido em 01/10/2026, abrir uma conversa
          disparava 31 chamadas de API, a maioria `/messages/<id>/media` a ~1,7s
          cada — no navegador do vendedor isso estourava o teto de 10s do
          cliente e enchia a tela de "A conexão demorou demais".

          O esqueleto saiu junto porque ele dependia de `onLoadedMetadata`, que
          com `preload="none"` só acontece depois do play: deixá-lo cobriria o
          player para sempre. O que aparece agora é o controle nativo sobre o
          fundo, e o navegador busca o vídeo quando a pessoa aperta play.
        */
        <video
          src={mediaSrc(messageId)}
          controls
          preload="none"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
        />
      )}
    </div>
  );
}
