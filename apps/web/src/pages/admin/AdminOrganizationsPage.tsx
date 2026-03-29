import { useMemo, useState } from "react";
import {
  type AdminOrganization,
  useAdminOrganizations,
  useAdminPlans,
  useAdminUpdateOrganization,
} from "../../api/admin";
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

const selectClass =
  "max-w-[200px] rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-900 focus:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-neutral-900/15 disabled:cursor-not-allowed disabled:opacity-60";

export function AdminOrganizationsPage() {
  const onForbidden = useAdminForbiddenRedirect();
  const { show, banner } = useFlashMessage();
  const { data: orgs, isLoading, error, refetch } = useAdminOrganizations();
  const { data: plans } = useAdminPlans();
  const updateOrg = useAdminUpdateOrganization();
  const [planDraft, setPlanDraft] = useState<Record<string, string>>({});

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
          const rowBusy =
            updateOrg.isPending && updateOrg.variables?.id === o.id;
          return (
            <select
              className={selectClass}
              disabled={rowBusy}
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
        header: "Блок",
        cell: (o) => (o.isBlocked ? "Да" : "Нет"),
      },
      {
        id: "actions",
        header: "Действия",
        cell: (o) => {
          const selected = planDraft[o.id] ?? o.planId;
          const planChanged = selected !== o.planId;
          const rowBusy =
            updateOrg.isPending && updateOrg.variables?.id === o.id;
          const blockLoading =
            rowBusy &&
            updateOrg.variables?.body?.isBlocked !== undefined;
          const planLoading =
            rowBusy && updateOrg.variables?.body?.planId !== undefined;

          return (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                className="min-h-0 px-2 py-1 text-xs"
                disabled={rowBusy}
                loading={blockLoading}
                onClick={async () => {
                  const nextBlocked = !o.isBlocked;
                  if (nextBlocked) {
                    if (
                      !confirm("Заблокировать организацию?")
                    ) {
                      return;
                    }
                  }
                  try {
                    await updateOrg.mutateAsync({
                      id: o.id,
                      body: { isBlocked: nextBlocked },
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
                {o.isBlocked ? "Разблокировать" : "Заблокировать"}
              </Button>
              {planChanged ? (
                <Button
                  className="min-h-0 px-2 py-1 text-xs"
                  disabled={rowBusy}
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
    [plans, planDraft, updateOrg, onForbidden, show]
  );

  return (
    <Page title="Организации" description="Планы, лимиты, блокировки.">
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
            rows={orgs ?? []}
            getRowId={(o) => o.id}
            isLoading={isLoading}
            emptyTitle="Нет данных"
          />
        )}
      </div>
    </Page>
  );
}
