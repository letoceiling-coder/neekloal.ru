import { useMemo, useState } from "react";
import { type AdminUserRow, useAdminUpdateUser, useAdminUsers } from "../../api/admin";
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
  "rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-900 focus:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-neutral-900/15 disabled:cursor-not-allowed disabled:opacity-60";

const ROLES: AdminUserRow["role"][] = ["user", "admin", "root"];

export function AdminUsersPage() {
  const onForbidden = useAdminForbiddenRedirect();
  const { show, banner } = useFlashMessage();
  const { data: users, isLoading, error, refetch } = useAdminUsers();
  const updateUser = useAdminUpdateUser();
  const [roleDraft, setRoleDraft] = useState<Record<string, AdminUserRow["role"]>>({});

  const columns = useMemo<DataTableColumn<AdminUserRow>[]>(
    () => [
      {
        id: "email",
        header: "Email",
        cell: (u) => <span className="font-mono text-xs">{u.email}</span>,
      },
      {
        id: "role",
        header: "Роль",
        cell: (u) => {
          const rowBusy =
            updateUser.isPending && updateUser.variables?.id === u.id;
          return (
            <select
              className={selectClass}
              disabled={rowBusy}
              aria-label={`Роль ${u.email}`}
              aria-busy={rowBusy}
              value={roleDraft[u.id] ?? u.role}
              onChange={(e) =>
                setRoleDraft((d) => ({
                  ...d,
                  [u.id]: e.target.value as AdminUserRow["role"],
                }))
              }
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          );
        },
      },
      {
        id: "actions",
        header: "",
        cell: (u) => {
          const next = roleDraft[u.id] ?? u.role;
          const changed = next !== u.role;
          const rowBusy =
            updateUser.isPending && updateUser.variables?.id === u.id;
          return (
            <Button
              className="min-h-0 px-2 py-1 text-xs"
              variant="secondary"
              disabled={!changed || rowBusy}
              loading={rowBusy}
              onClick={async () => {
                try {
                  await updateUser.mutateAsync({
                    id: u.id,
                    body: { role: next },
                  });
                  setRoleDraft((d) => {
                    const copy = { ...d };
                    delete copy[u.id];
                    return copy;
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
              Сохранить
            </Button>
          );
        },
      },
    ],
    [roleDraft, updateUser, onForbidden, show]
  );

  return (
    <Page title="Пользователи" description="Платформенные роли (user / admin / root).">
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
            rows={users ?? []}
            getRowId={(u) => u.id}
            isLoading={isLoading}
            emptyTitle="Нет данных"
          />
        )}
      </div>
    </Page>
  );
}
