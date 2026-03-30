import { useMemo, useState } from "react";
import {
  type AdminOrganization,
  useAdminDeleteOrganization,
  useAdminOrganizations,
  useAdminPlans,
  useAdminUpdateOrganization,
} from "../../api/admin";
import { AdminConfirmDialog } from "../../components/admin/AdminConfirmDialog";
import { useAdminForbiddenRedirect } from "../../hooks/useAdminForbiddenRedirect";
import { useDebounce } from "../../hooks/useDebounce";
import { useFlashMessage } from "../../hooks/useFlashMessage";
import { ApiError } from "../../lib/apiClient";
import {
  Button,
  DataTable,
  type DataTableColumn,
  EmptyState,
  ErrorState,
  Input,
  Page,
} from "../../components/ui";

const selectClass =
  "max-w-[200px] rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-900 focus:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-neutral-900/15 disabled:cursor-not-allowed disabled:opacity-60";

type StatusFilter = "all" | "active" | "blocked";

export function AdminOrganizationsPage() {
  const onForbidden = useAdminForbiddenRedirect();
  const { show, banner } = useFlashMessage();
  const { data: orgs, isLoading, error, refetch, isFetching } = useAdminOrganizations();
  const { data: plans } = useAdminPlans();
  const updateOrg = useAdminUpdateOrganization();
  const deleteOrg = useAdminDeleteOrganization();
  const [planDraft, setPlanDraft] = useState<Record<string, string>>({});
  const [searchRaw, setSearchRaw] = useState("");
  const debouncedSearch = useDebounce(searchRaw, 300);
  const [planFilter, setPlanFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [blockDialog, setBlockDialog] = useState<AdminOrganization | null>(null);
  const [blockPending, setBlockPending] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<AdminOrganization | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const filteredOrgs = useMemo(() => {
    let list = orgs ?? [];
    const q = debouncedSearch.trim().toLowerCase();
    if (q) list = list.filter((o) => o.name.toLowerCase().includes(q));
    if (planFilter !== "all") list = list.filter((o) => o.planId === planFilter);
    if (statusFilter === "active") list = list.filter((o) => !o.isBlocked);
    if (statusFilter === "blocked") list = list.filter((o) => o.isBlocked);
    return list;
  }, [orgs, debouncedSearch, planFilter, statusFilter]);

  const tableBusy = isFetching && !isLoading;

  const columns = useMemo<DataTableColumn<AdminOrganization>[]>(
    () => [
      {
        id: "name",
        header: "Название",
        cell: (o) => <span className="font-medium">{o.name}</span>,
      },
      {
        id: "plan",
        header: "План",
        cell: (o) => {
          const rowBusy = updateOrg.isPending && updateOrg.variables?.id === o.id;
          return (
            <select
              className={selectClass}
              disabled={rowBusy || tableBusy}
              aria-label={`План для ${o.name}`}
              aria-busy={rowBusy}
              value={planDraft[o.id] ?? o.planId}
              onChange={(e) =>
                setPlanDraft((d) => ({ ...d, [o.id]: e.target.value }))
              }
            >
              {(plans ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.slug})
                </option>
              ))}
            </select>
          );
        },
      },
      {
        id: "requests",
        header: "Запросы",
        cell: (o) => o.requestsUsed,
      },
      {
        id: "tokens",
        header: "Токены",
        cell: (o) => o.tokensUsed,
      },
      {
        id: "blocked",
        header: "Статус",
        cell: (o) => (
          <span
            className={
              o.isBlocked ? "text-red-700" : "text-emerald-700"
            }
          >
            {o.isBlocked ? "Заблокирована" : "Активна"}
          </span>
        ),
      },
      {
        id: "actions",
        header: "Действия",
        cell: (o) => {
          const selected = planDraft[o.id] ?? o.planId;
          const planChanged = selected !== o.planId;
          const rowBusy = updateOrg.isPending && updateOrg.variables?.id === o.id;
          const blockLoading =
            rowBusy && updateOrg.variables?.body?.isBlocked !== undefined;
          const planLoading =
            rowBusy && updateOrg.variables?.body?.planId !== undefined;
          const deleteLoading = deleteOrg.isPending && deleteOrg.variables === o.id;

          return (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                className="min-h-0 px-2 py-1 text-xs"
                disabled={rowBusy || tableBusy}
                loading={blockLoading}
                onClick={() => setBlockDialog(o)}
              >
                {o.isBlocked ? "Разблокировать" : "Заблокировать"}
              </Button>
              <Button
                variant="secondary"
                className="min-h-0 border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                disabled={rowBusy || tableBusy || deleteLoading}
                loading={deleteLoading}
                onClick={() => setDeleteDialog(o)}
              >
                Удалить
              </Button>
              {planChanged ? (
                <Button
                  className="min-h-0 px-2 py-1 text-xs"
                  disabled={rowBusy || tableBusy}
                  loading={planLoading}
                  onClick={async () => {
                    try {
                      await updateOrg.mutateAsync({
                        id: o.id,
                        body: { planId: selected },
                      });
                      setPlanDraft((d) => {
                        const next = { ...d };
                        delete next[o.id];
                        return next;
                      });
                      show("Сохранено");
                    } catch (err) {
                      onForbidden(err);
                      if (err instanceof ApiError && err.status !== 403) {
                        console.error(err);
                      }
                    }
                  }}
                >
                  Сохранить план
                </Button>
              ) : null}
            </div>
          );
        },
      },
    ],
    [plans, planDraft, updateOrg, deleteOrg, onForbidden, show, tableBusy]
  );

  const listEmpty = !isLoading && (orgs?.length ?? 0) === 0;
  const filterEmpty =
    !isLoading && (orgs?.length ?? 0) > 0 && filteredOrgs.length === 0;

  return (
    <Page
      title="Организации"
      description="Поиск, фильтры, планы, блокировка и удаление (soft delete). Удаление возможно только если в организации нет участников."
    >
      <div className="space-y-4">
        {banner}
        <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              id="org-search"
              label="Поиск по названию"
              placeholder="Компания…"
              value={searchRaw}
              disabled={!!error}
              onChange={(e) => setSearchRaw(e.target.value)}
            />
            <div>
              <label
                htmlFor="org-filter-plan"
                className="mb-1 block text-xs font-medium text-neutral-600"
              >
                План
              </label>
              <select
                id="org-filter-plan"
                className={selectClass + " max-w-none w-full"}
                value={planFilter}
                disabled={!!error}
                onChange={(e) => setPlanFilter(e.target.value)}
              >
                <option value="all">Все планы</option>
                {(plans ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="org-filter-status"
                className="mb-1 block text-xs font-medium text-neutral-600"
              >
                Статус
              </label>
              <select
                id="org-filter-status"
                className={selectClass + " max-w-none w-full"}
                value={statusFilter}
                disabled={!!error}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              >
                <option value="all">Все</option>
                <option value="active">Активные</option>
                <option value="blocked">Заблокированные</option>
              </select>
            </div>
          </div>
        </div>

        {error ? (
          <ErrorState
            message={error instanceof Error ? error.message : "Ошибка загрузки"}
            onRetry={() => void refetch()}
          />
        ) : isLoading && !orgs ? (
          <DataTable<AdminOrganization>
            columns={columns}
            rows={[]}
            getRowId={() => "—"}
            isLoading
            loadingMode="skeleton"
            skeletonRows={10}
            emptyTitle="—"
          />
        ) : listEmpty ? (
          <EmptyState
            title="Нет организаций"
            description="В системе пока нет организаций."
          />
        ) : filterEmpty ? (
          <EmptyState
            title="Ничего не найдено"
            description="Измените поиск или фильтры."
          />
        ) : (
          <div className={tableBusy ? "pointer-events-none opacity-70" : undefined}>
            <DataTable
              columns={columns}
              rows={filteredOrgs}
              getRowId={(o) => o.id}
              isLoading={false}
              loadingMode="skeleton"
              emptyTitle="Нет данных"
            />
          </div>
        )}

        <AdminConfirmDialog
          open={deleteDialog != null}
          title="Удалить организацию?"
          description={
            deleteDialog
              ? `«${deleteDialog.name}» будет скрыта (soft delete). Доступно только если нет участников в организации.`
              : undefined
          }
          confirmLabel="Удалить"
          destructive
          pending={deletePending}
          onClose={() => !deletePending && setDeleteDialog(null)}
          onConfirm={async () => {
            if (!deleteDialog) return;
            setDeletePending(true);
            try {
              await deleteOrg.mutateAsync(deleteDialog.id);
              show("Организация удалена");
              setDeleteDialog(null);
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

        <AdminConfirmDialog
          open={blockDialog != null}
          title={
            blockDialog?.isBlocked
              ? "Разблокировать организацию?"
              : "Заблокировать организацию?"
          }
          description={
            blockDialog
              ? `«${blockDialog.name}» — ${blockDialog.isBlocked ? "клиенты снова смогут пользоваться сервисом." : "доступ будет ограничен."}`
              : undefined
          }
          confirmLabel={blockDialog?.isBlocked ? "Разблокировать" : "Заблокировать"}
          destructive={!blockDialog?.isBlocked}
          pending={blockPending}
          onClose={() => !blockPending && setBlockDialog(null)}
          onConfirm={async () => {
            if (!blockDialog) return;
            const o = blockDialog;
            const nextBlocked = !o.isBlocked;
            setBlockPending(true);
            try {
              await updateOrg.mutateAsync({
                id: o.id,
                body: { isBlocked: nextBlocked },
              });
              show("Сохранено");
              setBlockDialog(null);
            } catch (err) {
              onForbidden(err);
              if (err instanceof ApiError && err.status !== 403) {
                console.error(err);
              }
            } finally {
              setBlockPending(false);
            }
          }}
        />
      </div>
    </Page>
  );
}
