import { useMemo, useState } from "react";
import { useAdminOrganizations, type AdminUsageItem, useAdminUsage } from "../../api/admin";
import { useModels } from "../../api/models";
import { AdminCommandSelect } from "../../components/admin/AdminCommandSelect";
import { useAdminForbiddenRedirect } from "../../hooks/useAdminForbiddenRedirect";
import { ApiError } from "../../lib/apiClient";
import {
  Button,
  DataTable,
  type DataTableColumn,
  ErrorState,
  Page,
} from "../../components/ui";

const PAGE = 50;

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function AdminUsagePage() {
  const onForbidden = useAdminForbiddenRedirect();
  const [offset, setOffset] = useState(0);
  const [orgId, setOrgId] = useState("");
  const [model, setModel] = useState("");

  const { data: orgs } = useAdminOrganizations();
  const { data: modelCatalog = [] } = useModels();

  const orgOptions = useMemo(() => {
    const list = orgs ?? [];
    return [
      { value: "", label: "Все организации" },
      ...list.map((o) => ({
        value: o.id,
        label: `${o.name} · ${o.slug}`,
      })),
    ];
  }, [orgs]);

  const filters =
    orgId.trim() || model.trim()
      ? {
          organizationId: orgId.trim() || undefined,
          model: model.trim() || undefined,
        }
      : undefined;

  const { data, isLoading, error, refetch, isFetching } = useAdminUsage(
    PAGE,
    offset,
    filters
  );

  const modelOptionsMerged = useMemo(() => {
    const seen = new Set(modelCatalog);
    const extra: { value: string; label: string }[] = [];
    for (const item of data?.items ?? []) {
      if (!seen.has(item.model)) {
        seen.add(item.model);
        extra.push({ value: item.model, label: item.model });
      }
    }
    extra.sort((a, b) => a.label.localeCompare(b.label));
    return [
      { value: "", label: "Все модели" },
      ...modelCatalog.map((m) => ({ value: m, label: m })),
      ...extra,
    ];
  }, [data?.items, modelCatalog]);

  const columns = useMemo<DataTableColumn<AdminUsageItem>[]>(
    () => [
      {
        id: "time",
        header: "Время",
        cell: (r) => (
          <span className="text-xs text-neutral-500">{formatDate(r.createdAt)}</span>
        ),
      },
      {
        id: "org",
        header: "Организация",
        cell: (r) => r.organization?.name ?? r.organizationId,
      },
      {
        id: "user",
        header: "Пользователь",
        cell: (r) => r.user?.email ?? "—",
      },
      {
        id: "model",
        header: "Модель",
        cell: (r) => <span className="font-mono text-xs">{r.model}</span>,
      },
      {
        id: "tokens",
        header: "Токены",
        cell: (r) => r.tokens,
      },
    ],
    []
  );

  const total = data?.total ?? 0;
  const canPrev = offset > 0;
  const canNext = offset + PAGE < total;

  function clearFilters() {
    setOrgId("");
    setModel("");
    setOffset(0);
  }

  return (
    <Page title="Usage" description="Фильтры по организации и модели, пагинация.">
      <div className="space-y-4">
        <div className="grid gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
          <AdminCommandSelect
            id="usage-org"
            label="Организация"
            options={orgOptions}
            value={orgId}
            onChange={(v) => {
              setOrgId(v);
              setOffset(0);
            }}
            placeholder="Все организации"
            searchPlaceholder="Поиск по названию или slug…"
            disabled={isLoading && !data}
          />
          <AdminCommandSelect
            id="usage-model"
            label="Модель"
            options={modelOptionsMerged}
            value={model}
            onChange={(v) => {
              setModel(v);
              setOffset(0);
            }}
            placeholder="Все модели"
            searchPlaceholder="Поиск модели…"
            disabled={isLoading && !data}
          />
          <div className="flex items-end gap-2">
            <Button
              type="button"
              variant="ghost"
              className="min-h-9"
              disabled={!orgId && !model}
              onClick={() => clearFilters()}
            >
              Сбросить фильтры
            </Button>
          </div>
        </div>

        {error ? (
          <ErrorState
            message={error instanceof Error ? error.message : "Ошибка загрузки"}
            onRetry={() => {
              if (error instanceof ApiError && error.status === 403) {
                onForbidden(error);
                return;
              }
              void refetch();
            }}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-neutral-500">
                Всего записей: {total}. На странице {data?.items.length ?? 0}, offset {offset}.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="min-h-0 px-3 py-1.5 text-xs"
                  disabled={!canPrev || isFetching}
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
                >
                  Назад
                </Button>
                <Button
                  variant="secondary"
                  className="min-h-0 px-3 py-1.5 text-xs"
                  disabled={!canNext || isFetching}
                  onClick={() => setOffset((o) => o + PAGE)}
                >
                  Вперёд
                </Button>
              </div>
            </div>
            <div className={isFetching && !isLoading ? "opacity-70" : undefined}>
              <DataTable
                className="mt-2"
                columns={columns}
                rows={data?.items ?? []}
                getRowId={(r) => r.id}
                isLoading={isLoading}
                loadingMode="skeleton"
                skeletonRows={12}
                emptyTitle="Нет записей usage"
              />
            </div>
          </>
        )}
      </div>
    </Page>
  );
}
