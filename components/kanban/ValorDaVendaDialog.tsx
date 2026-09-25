"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseReaisToCents, formatCentsBRL } from "@/lib/money";

/**
 * Pergunta o valor no instante em que o negócio vira venda.
 *
 * O campo "Valor (R$)" já existia no cadastro do negócio, e justamente por
 * isso ninguém preenchia: quem fecha a venda arrasta o card e segue atendendo.
 * O valor só é verdade neste instante, e é ele que vira o faturamento que o
 * Meta usa para otimizar a campanha — venda sem valor não vira conversão.
 *
 * "Não sei o valor" existe de propósito: travar o funil para cobrar um número
 * faria o vendedor parar de arrastar o card, e aí o CRM perde a venda inteira,
 * não só o valor.
 */
export function ValorDaVendaDialog({
  aberto,
  nomeDoNegocio,
  onConfirmar,
  onPular,
  onCancelar,
}: {
  aberto: boolean;
  nomeDoNegocio: string;
  onConfirmar: (valueCents: number) => void;
  onPular: () => void;
  onCancelar: () => void;
}) {
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (aberto) {
      setValor("");
      setErro(null);
    }
  }, [aberto]);

  const centavos = valor.trim() ? parseReaisToCents(valor.trim()) : null;

  function confirmar() {
    if (centavos === null || centavos <= 0) {
      setErro("Digite o valor da venda, por exemplo 1299,90.");
      return;
    }
    onConfirmar(centavos);
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onCancelar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quanto foi a venda?</DialogTitle>
          <DialogDescription>
            {nomeDoNegocio} está indo para a etapa de venda fechada. O valor fica no
            negócio e volta para o Meta como conversão do anúncio.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="valor-da-venda">Valor (R$)</Label>
          <Input
            id="valor-da-venda"
            autoFocus
            inputMode="decimal"
            placeholder="1299,90"
            value={valor}
            onChange={(e) => {
              setValor(e.target.value);
              setErro(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && confirmar()}
          />
          {centavos !== null && centavos > 0 && !erro ? (
            <p className="text-sm text-text-muted">{formatCentsBRL(centavos)}</p>
          ) : null}
          {erro ? <p className="text-sm text-destructive">{erro}</p> : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onClick={onPular}>
            Não sei o valor
          </Button>
          <Button type="button" onClick={confirmar}>
            Registrar venda
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
