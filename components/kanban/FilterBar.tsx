"use client";
import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUser } from "@/hooks/auth/AuthProvider";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useAssignableAgents } from "@/hooks/kanban/useAssignableAgents";
import type { Lead, OwnerKind } from "@/lib/types/leads";
import { OwnerBadge } from "./OwnerBadge";
import {
  agentOwnerFilter,
  parseAgentOwnerFilter,
  diaEmRecife,
  type LeadFilters,
} from "@/lib/kanban/filters";
import { cn } from "@/lib/utils";

interface FilterBarProps {
  filters: LeadFilters;
  onChange: (next: LeadFilters) => void;
  leads: Lead[];
}

/**
 * Atalhos de periodo. Datas em Recife — `new Date()` do navegador ja esta na
 * hora local do lojista, mas `diaEmRecife` mantem a mesma conta dos dois lados
 * mesmo se alguem abrir o board de outro fuso.
 */
function atalhoDePeriodo(dias: number): { entradaDe: string; entradaAte: string } {
  const agora = Date.now();
  return {
    entradaDe: diaEmRecife(new Date(agora - (dias - 1) * 86_400_000).toISOString()),
    entradaAte: diaEmRecife(new Date(agora).toISOString()),
  };
}

function inicioDoMes(): { entradaDe: string; entradaAte: string } {
  const hoje = diaEmRecife(new Date().toISOString());
  return { entradaDe: `${hoje.slice(0, 7)}-01`, entradaAte: hoje };
}

const ATALHOS: Array<{ label: string; valor: () => { entradaDe: string; entradaAte: string } }> = [
  { label: "Hoje", valor: () => atalhoDePeriodo(1) },
  { label: "7 dias", valor: () => atalhoDePeriodo(7) },
  { label: "30 dias", valor: () => atalhoDePeriodo(30) },
  { label: "Este mês", valor: inicioDoMes },
];

const STATUS_OPTIONS: Array<{ value: NonNullable<LeadFilters["status"]>; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "open", label: "Abertos" },
  { value: "won", label: "Ganhos" },
  { value: "lost", label: "Perdidos" },
];

export function FilterBar({ filters, onChange, leads }: FilterBarProps) {
  const user = useUser();
  const { data: members } = useAssignableMembers(true);
  const { data: agents } = useAssignableAgents(true);
  const [searchInput, setSearchInput] = useState(filters.search ?? "");

  // Debounce search 250ms
  useEffect(() => {
    const t = setTimeout(() => {
      if ((filters.search ?? "") !== searchInput) {
        onChange({ ...filters, search: searchInput });
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of leads) for (const t of l.tags) set.add(t);
    return Array.from(set).sort();
  }, [leads]);

  const filteredAgentId = parseAgentOwnerFilter(filters.owner);

  /**
   * Responsáveis atribuíveis numa lista única — humanos e agentes ordenados
   * juntos. O dono de um lead é UM campo; quem pode ser dono aparece numa lista
   * só. A distinção é geométrica (avatar), nunca posicional.
   */
  const assignees = useMemo(() => {
    type Row = {
      key: string;
      owner: string;
      name: string;
      kind: OwnerKind;
      version: number | null;
    };
    const rows: Row[] = [
      ...(members ?? [])
        .filter((m) => m.user_id !== user.id)
        .map((m) => ({
          key: `u:${m.user_id}`,
          owner: m.user_id,
          name: m.full_name ?? "Sem nome",
          kind: "user" as OwnerKind,
          version: null,
        })),
      ...(agents ?? []).map((a) => ({
        key: `a:${a.agent_id}`,
        owner: agentOwnerFilter(a.agent_id),
        name: a.name,
        kind: "ai" as OwnerKind,
        version: a.version_number,
      })),
    ];
    return rows.sort((x, y) => x.name.localeCompare(y.name, "pt-BR"));
  }, [members, agents, user.id]);
  const ownerLabel =
    filters.owner === "unassigned"
      ? "Sem responsável"
      : !filters.owner || filters.owner === "any"
        ? "Todos"
        : filteredAgentId
          ? (agents?.find((a) => a.agent_id === filteredAgentId)?.name ?? "Agente")
          : filters.owner === user.id
            ? "Eu"
            : (members?.find((m) => m.user_id === filters.owner)?.full_name ??
              "Responsável");

  const statusLabel =
    STATUS_OPTIONS.find((o) => o.value === (filters.status ?? "all"))?.label ?? "Todos";

  const tagLabel = filters.tag ?? "Tag: todas";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2">
      <Input
        type="search"
        placeholder="Buscar por título…"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        className="h-9 w-full sm:w-64"
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">Responsável: {ownerLabel}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Responsável</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onChange({ ...filters, owner: "any" })}>
            Todos
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onChange({ ...filters, owner: "unassigned" })}>
            Sem responsável
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onChange({ ...filters, owner: user.id })}>
            Eu
          </DropdownMenuItem>
          {/*
            Humanos e agentes numa lista SÓ, ordenados juntos por nome. Não existe
            separador entre eles: separador agrupa, e agrupar comunica "as pessoas,
            e depois também os bots" — segregação por posição, que é a mesma ideia
            do badge "AI" colorido que o contrato de UI proíbe. Quem distingue é o
            avatar (disco preenchido = humano, círculo vazado com anel = agente),
            reusando o OwnerBadge do card para os dois não divergirem.
            O separador ACIMA (linha do "Eu") fica: ele divide as opções meta
            (Todos / Sem responsável / Eu) das pessoas, e ali agrupar está certo.
          */}
          {assignees.length > 0 && (
            <>
              <DropdownMenuSeparator />
              {assignees.map((a) => (
                <DropdownMenuItem key={a.key} onClick={() => onChange({ ...filters, owner: a.owner })}>
                  <OwnerBadge
                    ownerKind={a.kind}
                    ownerName={a.name}
                    agentVersion={a.version}
                  />
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">Status: {statusLabel}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {STATUS_OPTIONS.map((o) => (
            <DropdownMenuItem
              key={o.value}
              onClick={() => onChange({ ...filters, status: o.value })}
            >
              {o.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={tagOptions.length === 0}>
            {tagLabel}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => onChange({ ...filters, tag: undefined })}>
            Todas
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {tagOptions.map((t) => (
            <DropdownMenuItem key={t} onClick={() => onChange({ ...filters, tag: t })}>
              {t}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <label
        className={cn(
          "flex cursor-pointer select-none items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm",
          filters.overdueOnly && "border-accent bg-accent/10",
        )}
      >
        <input
          type="checkbox"
          checked={!!filters.overdueOnly}
          onChange={(e) => onChange({ ...filters, overdueOnly: e.target.checked })}
        />
        Apenas atrasados
      </label>

      <label
        className={cn(
          "flex cursor-pointer select-none items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm",
          filters.paradosOnly && "border-accent bg-accent/10",
        )}
        title="Nenhuma atividade há 24h ou mais — o mesmo que o card marca como sem resposta"
      >
        <input
          type="checkbox"
          checked={!!filters.paradosOnly}
          onChange={(e) => onChange({ ...filters, paradosOnly: e.target.checked })}
        />
        Parados sem resposta
      </label>

      <div className="flex flex-wrap items-center gap-1 rounded-md border border-border px-2 py-1">
        <span className="px-1 text-xs text-muted-foreground">Entrou:</span>
        {ATALHOS.map((a) => {
          const v = a.valor();
          const ativo =
            filters.entradaDe === v.entradaDe && filters.entradaAte === v.entradaAte;
          return (
            <Button
              key={a.label}
              variant="ghost"
              size="sm"
              className={cn("h-7 px-2 text-xs", ativo && "bg-accent/15 text-accent")}
              onClick={() =>
                onChange(
                  ativo
                    ? { ...filters, entradaDe: undefined, entradaAte: undefined }
                    : { ...filters, ...v },
                )
              }
            >
              {a.label}
            </Button>
          );
        })}
        <input
          type="date"
          aria-label="Entrou a partir de"
          className="h-7 rounded border border-border bg-transparent px-1 text-xs"
          value={filters.entradaDe ?? ""}
          max={filters.entradaAte || undefined}
          onChange={(e) =>
            onChange({ ...filters, entradaDe: e.target.value || undefined })
          }
        />
        <span className="text-xs text-muted-foreground">até</span>
        <input
          type="date"
          aria-label="Entrou até"
          className="h-7 rounded border border-border bg-transparent px-1 text-xs"
          value={filters.entradaAte ?? ""}
          min={filters.entradaDe || undefined}
          onChange={(e) =>
            onChange({ ...filters, entradaAte: e.target.value || undefined })
          }
        />
      </div>

      {(filters.search ||
        filters.owner ||
        filters.tag ||
        filters.overdueOnly ||
        filters.paradosOnly ||
        filters.entradaDe ||
        filters.entradaAte ||
        (filters.status && filters.status !== "all")) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearchInput("");
            onChange({ status: "all" });
          }}
        >
          Limpar filtros
        </Button>
      )}
    </div>
  );
}
