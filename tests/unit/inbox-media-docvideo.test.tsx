import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocumentCard } from "@/components/inbox/media/DocumentCard";
import { VideoMedia } from "@/components/inbox/media/VideoMedia";

describe("VideoMedia", () => {
  it("renderiza <video> com controles apontando pro endpoint", () => {
    const { container } = render(<VideoMedia messageId="m4" />);
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("src", "/api/v1/messages/m4/media");
    expect(video).toHaveAttribute("controls");
  });

  it("caixa estável aspect-video mantém proporção", () => {
    const { container } = render(<VideoMedia messageId="m4" />);
    const box = container.querySelector(".aspect-video");
    expect(box).not.toBeNull();
    expect(box).toHaveClass("relative", "w-full", "max-w-sm", "overflow-hidden", "rounded-lg");
  });

  /**
   * NÃO BAIXA NADA ATÉ O PLAY, e o esqueleto saiu junto.
   *
   * Com `preload="metadata"`, todo vídeo da thread buscava o arquivo assim que
   * a bolha renderizava: abrir uma conversa disparava 31 chamadas de API, a
   * maioria `/messages/<id>/media` (medido em 01/10/2026), e no navegador do
   * vendedor isso estourava o teto de 10s do cliente. O esqueleto dependia de
   * `loadedmetadata`, que com `preload="none"` só acontece depois do play —
   * mantê-lo cobriria o player para sempre.
   */
  it("não busca o arquivo antes do play, e não fica coberto esperando", () => {
    const { container } = render(<VideoMedia messageId="m4" />);
    const video = container.querySelector("video")!;

    expect(video).toHaveAttribute("preload", "none");
    expect(container.querySelector(".absolute.inset-0")).toBeNull();
  });

  it("mostra fallback quando o vídeo falha (dentro do container)", () => {
    const { container } = render(<VideoMedia messageId="m4" />);
    const video = container.querySelector("video")!;

    fireEvent.error(video);

    const aspectVideoBox = container.querySelector(".aspect-video");
    expect(aspectVideoBox).not.toBeNull();
    expect(screen.getByText("Mídia indisponível")).toBeInTheDocument();

    // Verifica que o fallback está dentro do container aspect-video
    expect(aspectVideoBox?.contains(screen.getByText("Mídia indisponível"))).toBe(true);
  });
});

describe("DocumentCard", () => {
  it("mostra rótulo, tamanho e link de download", () => {
    render(
      <DocumentCard
        messageId="m5"
        mime="application/pdf"
        sizeBytes={3179614}
        storagePath="org/conv/m5.pdf"
        isOutbound={false}
      />,
    );
    expect(screen.getByText("PDF")).toBeInTheDocument();
    expect(screen.getByText(/3,0 MB/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /baixar pdf \(3,0 MB\)/i });
    expect(link).toHaveAttribute("href", "/api/v1/messages/m5/media");
    expect(link).toHaveAttribute("target", "_blank");
  });
});
