import { useMemo, useState } from "react";
import { type AdminPlan, useAdminPlans, useAdminUpdatePlan } from "../../api/admin";
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
  models: string;
};

const textareaClass =
  "min-h-[72px] w-full min-w-[180px] max-w-[280px] rounded-md border border-neutral-200 px-2 py-1.5 font-mono text-xs text-neutral-900 focus:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-neutral-900/15 disabled:cursor-not-allowed disabled:opacity-60";

function planToDraft(p: AdminPlan): Draft {
  const am = p.allowedModels;
  const modelsStr =
    am === "*" || (typeof am === "string" && am.trim() === "*")
      ? "*"
      : JSON.stringify(am ?? []);
  return {
    name: p.name,
    maxReq: p.maxRequestsPerMonth == null ? "" : String(p.maxRequestsPerMonth),
    maxTok: p.maxTokensPerMonth == null ? "" : String(p.maxTokensPerMonth),
    models: modelsStr,
  };
}

/** @returns parsed value or throws on invalid JSON / shape */
function parseAllowedModels(text: string): unknown {
  const t = text.trim();
  if (t === "*") return "*";
  let parsed: unknown;
  try {
    parsed = JSON.parse(t) as unknown;
  } catch {
    throw new Error("Неверный формат");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Неверный формат");
  }
  for (const x of parsed) {
    if (typeof x !== "string" || !x.trim()) {
      throw new Error("Неверный формат");
    }
  }
  return parsed;
}

export function AdminPlansPage() {
  const onForbidden = useAdminForbiddenRedirect();
  const { show, banner } = useFlashMessage();
  const { data: plans, isLoading, error, refetch } = useAdminPlans();
  const updatePlan = useAdminUpdatePlan();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [modelsError, setModelsError] = useState<Record<string, string>>({});
  const [rowHint, setRowHint] = useState<Record<string, string>>({});

  const getDraft = (p: AdminPlan): Draft =>
    drafts[p.id] ?? planToDraft(p);

  const setField = (id: string, p: AdminPlan, field: keyof Draft, value: string) => {
    if (field === "models") {
      setModelsError((e) => {
        const next = { ...e };
        delete next[id];
        return next;
      });
    }
    setDrafts((d) => ({
      ...d,
      [id]: { ...getDraft(p), [field]: value },
    }));
  };

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
          const rowBusy =
            updatePlan.isPending && updatePlan.variables?.id === p.id;
          return (
            <Input
              id={`plan-name-${p.id}`}
              value={d.name}
              disabled={rowBusy}
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
          const rowBusy =
            updatePlan.isPending && updatePlan.variables?.id === p.id;
          return (
            <input
              id={`plan-mr-${p.id}`}
              type="number"
              min={0}
              disabled={rowBusy}
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
          const rowBusy =
            updatePlan.isPending && updatePlan.variables?.id === p.id;
          return (
            <input
              id={`plan-mt-${p.id}`}
              type="number"
              min={0}
              disabled={rowBusy}
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
        header: "Модели (* или JSON)",
        cell: (p) => {
          const d = getDraft(p);
          const rowBusy =
            updatePlan.isPending && updatePlan.variables?.id === p.id;
          const err = modelsError[p.id];
          return (
            <div className="flex max-w-[280px] flex-col gap-1">
              <textarea
                id={`plan-am-${p.id}`}
                className={textareaClass}
                disabled={rowBusy}
                aria-invalid={Boolean(err)}
                value={d.models}
                onChange={(e) => setField(p.id, p, "models", e.target.value)}
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
            d.models !== orig.models;
          const rowBusy =
            updatePlan.isPending && updatePlan.variables?.id === p.id;
          const hint = rowHint[p.id];
          return (
            <div className="flex min-w-[100px] flex-col gap-1">
              <Button
                className="min-h-0 px-2 py-1 text-xs"
                variant="secondary"
                disabled={!changed || rowBusy}
                loading={rowBusy}
                onClick={async () => {
                  setRowHint((h) => {
                    const next = { ...h };
                    delete next[p.id];
                    return next;
                  });
                  let allowedModels: unknown;
                  try {
                    allowedModels = parseAllowedModels(d.models);
                  } catch {
                    setModelsError((e) => ({
                      ...e,
                      [p.id]: "Неверный формат",
                    }));
                    return;
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
    [drafts, modelsError, rowHint, updatePlan, onForbidden, show]
  );

  return (
    <Page
      title="Планы"
      description="Модели: * или JSON-массив строк в многострочном поле."
    >
      <div className="space-y-4">
        {banner}
        {error ? (
          <ErrorState
            message={
              error instanceof Error ? error.message : "Ошибка загрузки"
            }
            onRetry={() => void refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={plans ?? []}
            getRowId={(p) => p.id}
            isLoading={isLoading}
            emptyTitle="Нет данных"
          />
        )}
      </div>
    </Page>
  );
}
