import { useMemo, useState } from "react";
import {
  type AdminPlan,
  useAdminCreatePlan,
  useAdminDeletePlan,
  useAdminPlans,
  useAdminUpdatePlan,
} from "../../api/admin";
import { useModels } from "../../api/models";
import { AdminConfirmDialog } from "../../components/admin/AdminConfirmDialog";
import { PlanEditorDialog } from "../../components/admin/PlanEditorDialog";
import { orphanModelsFromPlan } from "../../components/admin/AllowedModelsEditor";
import { useAdminForbiddenRedirect } from "../../hooks/useAdminForbiddenRedirect";
import { useFlashMessage } from "../../hooks/useFlashMessage";
import { ApiError } from "../../lib/apiClient";
import {
  Button,
  DataTable,
  type DataTableColumn,
  ErrorState,
  Page,
} from "../../components/ui";

function formatModels(allowed: unknown): string {
  if (allowed === "*" || (typeof allowed === "string" && allowed.trim() === "*")) {
    return "*";
  }
  if (Array.isArray(allowed)) {
    return (allowed as unknown[]).map(String).join(", ") || "—";
  }
  return "—";
}

export function AdminPlansPage() {
  const onForbidden = useAdminForbiddenRedirect();
  const { show, banner } = useFlashMessage();
  const { data: plans, isLoading, error, refetch, isFetching } = useAdminPlans();
  const {
    data: modelCatalog = [],
    isLoading: catalogLoading,
    isError: catalogError,
  } = useModels();

  const createPlan = useAdminCreatePlan();
  const updatePlan = useAdminUpdatePlan();
  const deletePlan = useAdminDeletePlan();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editingPlan, setEditingPlan] = useState<AdminPlan | null>(null);
  const [editorSaveError, setEditorSaveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminPlan | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const tableBusy =
    isFetching && !isLoading
      ? true
      : createPlan.isPending || updatePlan.isPending || deletePlan.isPending;

  const editorPending = createPlan.isPending || updatePlan.isPending;

  function openCreate() {
    setEditorMode("create");
    setEditingPlan(null);
    setEditorSaveError(null);
    setEditorOpen(true);
  }

  function openEdit(p: AdminPlan) {
    setEditorMode("edit");
    setEditingPlan(p);
    setEditorSaveError(null);
    setEditorOpen(true);
  }

  function closeEditor() {
    if (editorPending) return;
    setEditorOpen(false);
    setEditingPlan(null);
    setEditorSaveError(null);
  }

  const columns = useMemo<DataTableColumn<AdminPlan>[]>(
    () => [
      {
        id: "slug",
        header: "Slug",
        cell: (p) => <span className="font-mono text-xs text-neutral-500">{p.slug}</span>,
      },
      {
        id: "name",
        header: "Название",
        cell: (p) => <span className="font-medium">{p.name}</span>,
      },
      {
        id: "maxReq",
        header: "Запр./мес",
        cell: (p) => (p.maxRequestsPerMonth == null ? "∞" : p.maxRequestsPerMonth),
      },
      {
        id: "maxTok",
        header: "Токены/мес",
        cell: (p) => (p.maxTokensPerMonth == null ? "∞" : p.maxTokensPerMonth),
      },
      {
        id: "models",
        header: "Модели",
        cell: (p) => {
          const orphans =
            !catalogLoading && !catalogError
              ? orphanModelsFromPlan(p.allowedModels, modelCatalog)
              : [];
          return (
            <div className="max-w-[220px]">
              {orphans.length > 0 ? (
                <p className="mb-1 text-[10px] text-amber-800">
                  Не в каталоге: {orphans.join(", ")}
                </p>
              ) : null}
              <span className="line-clamp-2 font-mono text-xs text-neutral-600">
                {formatModels(p.allowedModels)}
              </span>
            </div>
          );
        },
      },
      {
        id: "actions",
        header: "",
        cell: (p) => (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              className="min-h-0 px-2 py-1 text-xs"
              disabled={tableBusy}
              onClick={() => openEdit(p)}
            >
              Редактировать
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-0 border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
              disabled={tableBusy}
              onClick={() => setDeleteTarget(p)}
            >
              Удалить
            </Button>
          </div>
        ),
      },
    ],
    [catalogLoading, catalogError, modelCatalog, tableBusy]
  );

  return (
    <Page
      title="Планы"
      description="Создание, редактирование и удаление тарифов. Модели — из каталога API. Удаление плана возможно, если ни одна организация на нём не числится."
    >
      <div className="space-y-4">
        {banner}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" onClick={() => openCreate()} disabled={!!error || tableBusy}>
            Создать план
          </Button>
        </div>

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

        <PlanEditorDialog
          open={editorOpen}
          mode={editorMode}
          plan={editingPlan}
          modelCatalog={modelCatalog}
          catalogLoading={catalogLoading}
          catalogError={catalogError}
          pending={editorPending}
          saveError={editorSaveError}
          onClose={closeEditor}
          onSave={async (payload) => {
            setEditorSaveError(null);
            let allowedModels: unknown;
            if (payload.models === "*") {
              allowedModels = "*";
            } else {
              allowedModels = payload.models;
            }
            const maxRequestsPerMonth =
              payload.maxReq.trim() === ""
                ? null
                : Math.max(0, Math.floor(Number(payload.maxReq)));
            const maxTokensPerMonth =
              payload.maxTok.trim() === ""
                ? null
                : Math.max(0, Math.floor(Number(payload.maxTok)));
            if (maxRequestsPerMonth != null && !Number.isFinite(maxRequestsPerMonth)) {
              setEditorSaveError("Некорректный лимит запросов");
              return;
            }
            if (maxTokensPerMonth != null && !Number.isFinite(maxTokensPerMonth)) {
              setEditorSaveError("Некорректный лимит токенов");
              return;
            }
            try {
              if (editorMode === "create") {
                await createPlan.mutateAsync({
                  slug: payload.slug.trim().toLowerCase(),
                  name: payload.name.trim(),
                  maxRequestsPerMonth,
                  maxTokensPerMonth,
                  allowedModels,
                });
                show("План создан");
              } else if (editingPlan) {
                await updatePlan.mutateAsync({
                  id: editingPlan.id,
                  body: {
                    name: payload.name.trim(),
                    maxRequestsPerMonth,
                    maxTokensPerMonth,
                    allowedModels,
                  },
                });
                show("Сохранено");
              }
              closeEditor();
            } catch (err) {
              onForbidden(err);
              if (err instanceof ApiError && err.status !== 403) {
                setEditorSaveError(err.message);
              }
            }
          }}
        />

        <AdminConfirmDialog
          open={deleteTarget != null}
          title="Удалить план?"
          description={
            deleteTarget
              ? `План «${deleteTarget.name}» (${deleteTarget.slug}) будет скрыт. Организации на этом плане должны быть перенесены заранее.`
              : undefined
          }
          confirmLabel="Удалить"
          destructive
          pending={deletePending}
          onClose={() => !deletePending && setDeleteTarget(null)}
          onConfirm={async () => {
            if (!deleteTarget) return;
            setDeletePending(true);
            try {
              await deletePlan.mutateAsync(deleteTarget.id);
              show("План удалён");
              setDeleteTarget(null);
            } catch (err) {
              onForbidden(err);
              if (err instanceof ApiError && err.status !== 403) {
                show(err.message);
              }
            } finally {
              setDeletePending(false);
            }
          }}
        />
      </div>
    </Page>
  );
}
