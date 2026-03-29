import { useMemo, useState } from "react";
import { type AdminUsageItem, useAdminUsage } from "../../api/admin";
import { useAdminForbiddenRedirect } from "../../hooks/useAdminForbiddenRedirect";
import { ApiError } from "../../lib/apiClient";
import {
  Button,
  DataTable,
  type DataTableColumn,
  ErrorState,
  Input,
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
  const [orgDraft, setOrgDraft] = useState("");
  const [modelDraft, setModelDraft] = useState("");
  const [appliedOrg, setAppliedOrg] = useState("");
  const [appliedModel, setAppliedModel] = useState("");

  const filters =
    appliedOrg.trim() || appliedModel.trim()
      ? {
          organizationId: appliedOrg.trim() || undefined,
          model: appliedModel.trim() || undefined,
        }
      : undefined;

  const { data, isLoading, error, refetch } = useAdminUsage(
    PAGE,
    offset,
    filters
  );

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

  function applyFilters() {
    setAppliedOrg(orgDraft.trim());
    setAppliedModel(modelDraft.trim());
    setOffset(0);
  }

  function clearFilters() {
    setOrgDraft("");
    setModelDraft("");
    setAppliedOrg("");
    setAppliedModel("");
    setOffset(0);
  }

  return (
    <Page title="Usage" description="Фильтры, пагинация.">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-neutral-200 bg-neutral-50/80 p-3">
          <Input
            id="usage-filter-org"
            label="Organization ID"
            value={orgDraft}
            onChange={(e) => setOrgDraft(e.target.value)}
            placeholder="UUID"
            className="min-w-[200px]"
          />
          <Input
            id="usage-filter-model"
            label="Модель"
            value={modelDraft}
            onChange={(e) => setModelDraft(e.target.value)}
            placeholder="llama3.2"
            className="min-w-[160px]"
          />
          <Button
            type="button"
            variant="secondary"
            className="min-h-0 px-3 py-2 text-xs"
            disabled={isLoading}
            onClick={() => applyFilters()}
          >
            Применить
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-0 px-3 py-2 text-xs"
            disabled={isLoading}
            onClick={() => clearFilters()}
          >
            Сбросить
          </Button>
        </div>

        {error ? (
          <ErrorState
            message={
              error instanceof Error ? error.message : "Ошибка загрузки"
            }
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
                Всего записей: {total}. Показано {data?.items.length ?? 0} с
                offset {offset}.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="min-h-0 px-3 py-1.5 text-xs"
                  disabled={!canPrev || isLoading}
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
                >
                  Назад
                </Button>
                <Button
                  variant="secondary"
                  className="min-h-0 px-3 py-1.5 text-xs"
                  disabled={!canNext || isLoading}
                  onClick={() => setOffset((o) => o + PAGE)}
                >
                  Вперёд
                </Button>
              </div>
            </div>
            <DataTable
              className="mt-2"
              columns={columns}
              rows={data?.items ?? []}
              getRowId={(r) => r.id}
              isLoading={isLoading}
              emptyTitle="Нет данных"
            />
          </>
        )}
      </div>
    </Page>
  );
}
