import { useMemo, useState } from "react";
import { type AdminPlan, useAdminPlans, useAdminUpdatePlan } from "../../api/admin";
import {
  AllowedModelsEditor,
  type AllowedModelsValue,
  normalizeFromPlan,
} from "../../components/admin/AllowedModelsEditor";
import { useAdminForbiddenRedirect } from "../../hooks/useAdminForbiddenRedirect";
import { useFlashMessage } from "../../hooks/useFlashMessage";
import { ApiError } from "../../lib/apiClient";
import {
  Button,
  DataTable,
  type DataTableColumn,
  ErrorState,
  Input,
  Page,
} from "../../components/ui";

type Draft = {
  name: string;
  maxReq: string;
  maxTok: string;
  models: AllowedModelsValue;
};

function planToDraft(p: AdminPlan): Draft {
  return {
    name: p.name,
    maxReq: p.maxRequestsPerMonth == null ? "" : String(p.maxRequestsPerMonth),
    maxTok: p.maxTokensPerMonth == null ? "" : String(p.maxTokensPerMonth),
    models: normalizeFromPlan(p.allowedModels),
  };
}

function modelsEqual(a: AllowedModelsValue, b: AllowedModelsValue): boolean {
  if (a === "*" && b === "*") return true;
  if (a === "*" || b === "*") return false;
  if (a.length !== b.length) return false;
  const sa = [...a].sort().join("\0");
  const sb = [...b].sort().join("\0");
  return sa === sb;
}

export function AdminPlansPage() {
  const onForbidden = useAdminForbiddenRedirect();
  const { show, banner } = useFlashMessage();
  const { data: plans, isLoading, error, refetch, isFetching } = useAdminPlans();
  const updatePlan = useAdminUpdatePlan();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [modelsError, setModelsError] = useState<Record<string, string>>({});
  const [rowHint, setRowHint] = useState<Record<string, string>>({});

  const getDraft = (p: AdminPlan): Draft => drafts[p.id] ?? planToDraft(p);

  const setField = (id: string, p: AdminPlan, field: keyof Draft, value: string | AllowedModelsValue) => {
    if (field === "models") {
      setModelsError((e) => {
        const next = { ...e };
        delete next[id];
        return next;
      });
    }
    const base = getDraft(p);
    setDrafts((d) => ({
      ...d,
      [id]: {
        ...base,
        [field]: value,
      } as Draft,
    }));
  };

  const tableBusy = isFetching && !isLoading;

  const columns = useMemo<DataTableColumn<AdminPlan>[]>(
    () => [
      {
        id: "slug",
        header: "Slug",
        cell: (p) => (
          <span className="font-mono text-xs text-neutral-500">{p.slug}</span>
        ),
      },
      {
        id: "name",
        header: "Название",
        cell: (p) => {
          const d = getDraft(p);
          const rowBusy = updatePlan.isPending && updatePlan.variables?.id === p.id;
          return (
            <Input
              id={`plan-name-${p.id}`}
              value={d.name}
              disabled={rowBusy || tableBusy}
              onChange={(e) => setField(p.id, p, "name", e.target.value)}
              className="min-w-[140px]"
            />
          );
        },
      },
      {
        id: "maxReq",
        header: "Запр./мес",
        cell: (p) => {
          const d = getDraft(p);
          const rowBusy = updatePlan.isPending && updatePlan.variables?.id === p.id;
          return (
            <input
              id={`plan-mr-${p.id}`}
              type="number"
              min={0}
              disabled={rowBusy || tableBusy}
              className="w-24 rounded-md border border-neutral-200 px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              placeholder="∞"
              value={d.maxReq}
              onChange={(e) => setField(p.id, p, "maxReq", e.target.value)}
            />
          );
        },
      },
      {
        id: "maxTok",
        header: "Токены/мес",
        cell: (p) => {
          const d = getDraft(p);
          const rowBusy = updatePlan.isPending && updatePlan.variables?.id === p.id;
          return (
            <input
              id={`plan-mt-${p.id}`}
              type="number"
              min={0}
              disabled={rowBusy || tableBusy}
              className="w-28 rounded-md border border-neutral-200 px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              placeholder="∞"
              value={d.maxTok}
              onChange={(e) => setField(p.id, p, "maxTok", e.target.value)}
            />
          );
        },
      },
      {
        id: "models",
        header: "Модели",
        cell: (p) => {
          const d = getDraft(p);
          const rowBusy = updatePlan.isPending && updatePlan.variables?.id === p.id;
          const err = modelsError[p.id];
          return (
            <div className="flex flex-col gap-1">
              <AllowedModelsEditor
                planId={p.id}
                value={d.models}
                disabled={rowBusy || tableBusy}
                onChange={(next) => setField(p.id, p, "models", next)}
              />
              {err ? (
                <span className="text-xs text-red-600" role="alert">
                  {err}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "save",
        header: "",
        cell: (p) => {
          const d = getDraft(p);
          const orig = planToDraft(p);
          const changed =
            d.name !== orig.name ||
            d.maxReq !== orig.maxReq ||
            d.maxTok !== orig.maxTok ||
            !modelsEqual(d.models, orig.models);
          const rowBusy = updatePlan.isPending && updatePlan.variables?.id === p.id;
          const hint = rowHint[p.id];
          return (
            <div className="flex min-w-[100px] flex-col gap-1">
              <Button
                className="min-h-0 px-2 py-1 text-xs"
                variant="secondary"
                disabled={!changed || rowBusy || tableBusy}
                loading={rowBusy}
                onClick={async () => {
                  setRowHint((h) => {
                    const next = { ...h };
                    delete next[p.id];
                    return next;
                  });
                  let allowedModels: unknown;
                  if (d.models === "*") {
                    allowedModels = "*";
                  } else if (d.models.length === 0) {
                    setModelsError((e) => ({
                      ...e,
                      [p.id]: "Выберите модели или «Все модели»",
                    }));
                    return;
                  } else {
                    allowedModels = d.models;
                  }
                  const body: {
                    name?: string;
                    maxRequestsPerMonth?: number | null;
                    maxTokensPerMonth?: number | null;
                    allowedModels?: unknown;
                  } = { name: d.name.trim() || p.name };
                  body.maxRequestsPerMonth =
                    d.maxReq.trim() === ""
                      ? null
                      : Math.max(0, Math.floor(Number(d.maxReq)));
                  body.maxTokensPerMonth =
                    d.maxTok.trim() === ""
                      ? null
                      : Math.max(0, Math.floor(Number(d.maxTok)));
                  if (
                    body.maxRequestsPerMonth != null &&
                    !Number.isFinite(body.maxRequestsPerMonth)
                  ) {
                    setRowHint((h) => ({
                      ...h,
                      [p.id]: "Некорректный лимит запросов",
                    }));
                    return;
                  }
                  if (
                    body.maxTokensPerMonth != null &&
                    !Number.isFinite(body.maxTokensPerMonth)
                  ) {
                    setRowHint((h) => ({
                      ...h,
                      [p.id]: "Некорректный лимит токенов",
                    }));
                    return;
                  }
                  body.allowedModels = allowedModels;
                  try {
                    await updatePlan.mutateAsync({ id: p.id, body });
                    setDrafts((prev) => {
                      const next = { ...prev };
                      delete next[p.id];
                      return next;
                    });
                    setModelsError((e) => {
                      const next = { ...e };
                      delete next[p.id];
                      return next;
                    });
                    show("Сохранено");
                  } catch (err) {
                    onForbidden(err);
                    if (err instanceof ApiError && err.status !== 403) {
                      setRowHint((h) => ({
                        ...h,
                        [p.id]: err.message,
                      }));
                    }
                  }
                }}
              >
                Сохранить
              </Button>
              {hint ? (
                <span className="text-xs text-red-600" role="alert">
                  {hint}
                </span>
              ) : null}
            </div>
          );
        },
      },
    ],
    [drafts, modelsError, rowHint, updatePlan, onForbidden, show, tableBusy]
  );

  return (
    <Page
      title="Планы"
      description="Лимиты и список разрешённых моделей. «Все модели» = *; иначе явный набор — без JSON вручную."
    >
      <div className="space-y-4">
        {banner}
        {error ? (
          <ErrorState
            message={error instanceof Error ? error.message : "Ошибка загрузки"}
            onRetry={() => void refetch()}
          />
        ) : (
          <div className={tableBusy ? "pointer-events-none opacity-70" : undefined}>
            <DataTable
              columns={columns}
              rows={plans ?? []}
              getRowId={(p) => p.id}
              isLoading={isLoading}
              loadingMode="skeleton"
              skeletonRows={6}
              emptyTitle="Нет планов"
            />
          </div>
        )}
      </div>
    </Page>
  );
}
