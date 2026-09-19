"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { randomizerConfigSchema } from "@/lib/followup/graph-schema";
import { Plus, Trash } from "@/lib/ui/icons";

import type { ConfigOf } from "./shared";

type Caminho = ConfigOf<"randomizer">["branches"][number];

const MAX_CAMINHOS = 5;
const LETRAS = ["A", "B", "C", "D", "E"];

/** Id novo que não colide — opaco de propósito: é o que a seta referencia, e não
 *  pode mudar quando o usuário troca o nome do caminho. */
function novoId(caminhos: Caminho[]): string {
  const usados = new Set(caminhos.map((c) => c.id));
  for (let n = 1; ; n++) if (!usados.has(`caminho-${n}`)) return `caminho-${n}`;
}

/** Divide 100% o mais igual possível; a sobra vai para os primeiros. */
function dividirIgual(caminhos: Caminho[]): Caminho[] {
  const base = Math.floor(100 / caminhos.length);
  const sobra = 100 - base * caminhos.length;
  return caminhos.map((c, i) => ({ ...c, weight: base + (i < sobra ? 1 : 0) }));
}

export function RandomizerForm({
  config,
  onChange,
  ramosLigados = [],
}: {
  config: ConfigOf<"randomizer">;
  onChange: (c: ConfigOf<"randomizer">) => void;
  ramosLigados?: string[];
}) {
  const [caminhos, setCaminhos] = useState<Caminho[]>(config.branches);
  const [error, setError] = useState<string | null>(null);
  const soma = caminhos.reduce((s, c) => s + (Number.isFinite(c.weight) ? c.weight : 0), 0);

  const commit = (next: Caminho[]) => {
    setCaminhos(next);
    const parsed = randomizerConfigSchema.safeParse({ branches: next });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Configuração inválida.");
      return;
    }
    setError(null);
    onChange(parsed.data);
  };

  const atualizar = (i: number, patch: Partial<Caminho>) =>
    commit(caminhos.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        Cada lead cai em UM caminho, sorteado pelo peso. O mesmo lead sempre cai no mesmo caminho.
      </p>
      <div className="space-y-2">
        {caminhos.map((c, i) => (
          <div key={c.id} className="grid grid-cols-[1fr_5.5rem_2rem] items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor={`rand-label-${c.id}`}>Caminho</Label>
              <Input
                id={`rand-label-${c.id}`}
                value={c.label}
                maxLength={40}
                onChange={(e) => atualizar(i, { label: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`rand-peso-${c.id}`}>Peso %</Label>
              <Input
                id={`rand-peso-${c.id}`}
                type="number"
                min={1}
                max={100}
                value={Number.isFinite(c.weight) ? c.weight : ""}
                onChange={(e) => atualizar(i, { weight: Math.round(Number(e.target.value)) })}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remover caminho ${c.label}`}
              disabled={caminhos.length <= 2}
              onClick={() => commit(dividirIgual(caminhos.filter((_, j) => j !== i)))}
            >
              <Trash size={14} aria-hidden />
            </Button>
          </div>
        ))}
      </div>
      <p className={`text-xs ${soma === 100 ? "text-text-muted" : "text-error-fg"}`}>
        Total: {soma}% {soma === 100 ? "" : "— precisa dar 100%"}
      </p>
      {caminhos.some((c) => !ramosLigados.includes(c.id)) && (
        <p className="text-xs text-text-muted">Ligue cada caminho a um bloco no canvas antes de publicar.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={caminhos.length >= MAX_CAMINHOS}
          onClick={() =>
            commit(
              dividirIgual([
                ...caminhos,
                { id: novoId(caminhos), label: LETRAS[caminhos.length] ?? `${caminhos.length + 1}`, weight: 1 },
              ]),
            )
          }
        >
          <Plus size={14} aria-hidden /> Caminho
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => commit(dividirIgual(caminhos))}>
          Dividir igualmente
        </Button>
      </div>
      {error && <p className="text-xs text-error-fg">{error}</p>}
    </div>
  );
}
