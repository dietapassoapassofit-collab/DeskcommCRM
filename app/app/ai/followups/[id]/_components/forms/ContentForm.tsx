"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { contentConfigSchema, type ContentItem } from "@/lib/followup/graph-schema";
import { MIDIAS_DO_CONTEUDO } from "@/lib/followup/vocabulario";
import { usePreviaDaMidia, useSubirMidiaDoFluxo } from "@/hooks/followup/useMidiaDoFluxo";
import { CaretDown, CaretUp, Keyboard, Plus, Trash, UploadSimple } from "@/lib/ui/icons";

import type { ConfigOf } from "./shared";

const MAX_ITENS = 10;

function tamanhoLegivel(bytes: number | undefined): string {
  if (!bytes) return "";
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function Previa({ item }: { item: Extract<ContentItem, { kind: "media" }> }) {
  const { data: url } = usePreviaDaMidia(item.storage_path);
  if (!url) return <div className="h-14 w-14 shrink-0 rounded bg-surface-muted" aria-hidden />;
  return item.media_kind === "image" ? (
    // eslint-disable-next-line @next/next/no-img-element -- link assinado e temporário: o otimizador do Next não serve aqui
    <img src={url} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
  ) : (
    <video src={url} className="h-14 w-14 shrink-0 rounded object-cover" muted preload="metadata" />
  );
}

function tituloDoItem(item: ContentItem): string {
  if (item.kind === "text") return "Texto";
  if (item.kind === "typing") return "Digitando…";
  return MIDIAS_DO_CONTEUDO[item.media_kind];
}

export function ContentForm({
  config,
  onChange,
}: {
  config: ConfigOf<"content">;
  onChange: (c: ConfigOf<"content">) => void;
}) {
  const [itens, setItens] = useState<ContentItem[]>(config.items);
  const [error, setError] = useState<string | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const subir = useSubirMidiaDoFluxo();

  const commit = (next: ContentItem[]) => {
    setItens(next);
    const parsed = contentConfigSchema.safeParse({ items: next });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Configuração inválida.");
      return;
    }
    setError(null);
    onChange(parsed.data);
  };

  const mover = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= itens.length) return;
    const next = [...itens];
    [next[i], next[j]] = [next[j]!, next[i]!];
    commit(next);
  };

  const cheio = itens.length >= MAX_ITENS;

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        As mensagens saem nesta ordem, exatamente como escritas — sem a IA reescrever. Use{" "}
        <code>{"{{primeiro_nome}}"}</code> para o nome do cliente.
      </p>

      <ol className="space-y-2">
        {itens.map((item, i) => (
          <li key={i} className="space-y-2 rounded-md border border-border p-2">
            <div className="flex items-center justify-between text-xs text-text-muted">
              <span className="font-medium text-text">
                {i + 1} · {tituloDoItem(item)}
              </span>
              <span className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" aria-label="Subir" disabled={i === 0} onClick={() => mover(i, -1)}>
                  <CaretUp size={12} aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Descer"
                  disabled={i === itens.length - 1}
                  onClick={() => mover(i, 1)}
                >
                  <CaretDown size={12} aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Remover"
                  onClick={() => commit(itens.filter((_, j) => j !== i))}
                >
                  <Trash size={12} aria-hidden />
                </Button>
              </span>
            </div>

            {item.kind === "text" && (
              <Textarea
                id={`content-texto-${i}`}
                aria-label={`Texto da mensagem ${i + 1}`}
                value={item.text}
                maxLength={4000}
                rows={3}
                onChange={(e) => commit(itens.map((it, j) => (j === i ? { kind: "text", text: e.target.value } : it)))}
              />
            )}

            {item.kind === "typing" && (
              <div className="flex items-center gap-2 text-sm">
                <Label htmlFor={`content-digitando-${i}`}>Mostrar “digitando” por</Label>
                <Input
                  id={`content-digitando-${i}`}
                  type="number"
                  min={1}
                  max={20}
                  className="w-20"
                  value={item.seconds}
                  onChange={(e) =>
                    commit(itens.map((it, j) => (j === i ? { kind: "typing", seconds: Math.round(Number(e.target.value)) } : it)))
                  }
                />
                seg
              </div>
            )}

            {item.kind === "media" && (
              <div className="flex items-center gap-3 text-sm">
                <Previa item={item} />
                <div className="min-w-0">
                  <p className="truncate">{item.filename ?? MIDIAS_DO_CONTEUDO[item.media_kind]}</p>
                  <p className="text-xs text-text-muted">
                    {MIDIAS_DO_CONTEUDO[item.media_kind]} {tamanhoLegivel(item.size_bytes)}
                  </p>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>

      <input
        ref={arquivo}
        type="file"
        accept="image/jpeg,image/png,video/mp4"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const m = await subir.mutateAsync(f).catch(() => null);
          if (!m) return;
          commit([
            ...itens,
            {
              kind: "media",
              media_kind: m.media_kind,
              storage_path: m.storage_path,
              mime: m.mime,
              filename: m.filename,
              size_bytes: m.size_bytes,
            },
          ]);
        }}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={cheio}
          onClick={() => commit([...itens, { kind: "text", text: "Nova mensagem" }])}
        >
          <Plus size={14} aria-hidden /> Texto
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={cheio || subir.isPending}
          onClick={() => arquivo.current?.click()}
        >
          <UploadSimple size={14} aria-hidden /> {subir.isPending ? "Enviando…" : "Foto ou vídeo"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={cheio}
          onClick={() => commit([...itens, { kind: "typing", seconds: 3 }])}
        >
          <Keyboard size={14} aria-hidden /> Digitando
        </Button>
      </div>
      <p className="text-xs text-text-muted">
        Foto JPG/PNG até 5 MB, vídeo MP4 até 16 MB. No Instagram o “digitando” não aparece, e o envio só
        acontece para quem falou nas últimas 24h.
      </p>
      {error && <p className="text-xs text-error-fg">{error}</p>}
    </div>
  );
}
