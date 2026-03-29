import { useMemo, useState } from "react";
import {
  type AdminUserRow,
  useAdminDeleteUser,
  useAdminUpdateUser,
  useAdminUsers,
} from "../../api/admin";
import { AdminConfirmDialog } from "../../components/admin/AdminConfirmDialog";
import { useAdminForbiddenRedirect } from "../../hooks/useAdminForbiddenRedirect";
import { useDebounce } from "../../hooks/useDebounce";
import { useFlashMessage } from "../../hooks/useFlashMessage";
import { ApiError } from "../../lib/apiClient";
import { useAuthStore } from "../../stores/authStore";
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
  "rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-900 focus:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-neutral-900/15 disabled:cursor-not-allowed disabled:opacity-60";

const ROLES: AdminUserRow["role"][] = ["user", "admin", "root"];

type RoleFilter = "all" | AdminUserRow["role"];

export function AdminUsersPage() {
  const onForbidden = useAdminForbiddenRedirect();
  const { show, banner } = useFlashMessage();
  const myUserId = useAuthStore((s) => s.userId);
  const { data: users, isLoading, error, refetch, isFetching } = useAdminUsers();
  const updateUser = useAdminUpdateUser();
  const deleteUser = useAdminDeleteUser();
  const [deleteTarget, setDeleteTarget] = useState<AdminUserRow | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [roleDraft, setRoleDraft] = useState<Record<string, AdminUserRow["role"]>>({});
  const [searchRaw, setSearchRaw] = useState("");
  const debouncedSearch = useDebounce(searchRaw, 300);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  const filteredUsers = useMemo(() => {
    let list = users ?? [];
    const q = debouncedSearch.trim().toLowerCase();
    if (q) list = list.filter((u) => u.email.toLowerCase().includes(q));
    if (roleFilter !== "all") list = list.filter((u) => u.role === roleFilter);
    return list;
  }, [users, debouncedSearch, roleFilter]);

  const tableBusy = isFetching && !isLoading;

  const columns = useMemo<DataTableColumn<AdminUserRow>[]>(
    () => [
      {
        id: "email",
        header: "Email",
        cell: (u) => (
          <span className="font-mono text-xs">
            {u.email}
            {u.id === myUserId ? (
              <span className="ml-2 text-[10px] font-sans font-normal text-neutral-400">
                (вы)
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: "role",
        header: "Роль",
        cell: (u) => {
          const isSelf = u.id === myUserId;
          const rowBusy = updateUser.isPending && updateUser.variables?.id === u.id;
          return (
            <select
              className={selectClass}
              disabled={rowBusy || tableBusy || isSelf}
              title={isSelf ? "Нельзя изменить свою роль в этой панели" : undefined}
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
          const isSelf = u.id === myUserId;
          const isRoot = u.role === "root";
          const next = roleDraft[u.id] ?? u.role;
          const changed = next !== u.role;
          const rowBusy = updateUser.isPending && updateUser.variables?.id === u.id;
          const rowDeleteBusy = deleteUser.isPending && deleteUser.variables === u.id;
          const cantDelete = isSelf || isRoot;
          return (
            <div className="flex flex-col gap-2">
              <Button
                className="min-h-0 px-2 py-1 text-xs"
                variant="secondary"
                disabled={!changed || rowBusy || tableBusy || isSelf}
                title={isSelf ? "Нельзя изменить свою роль" : undefined}
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
                      show(err.message);
                    }
                  }
                }}
              >
                Сохранить роль
              </Button>
              <Button
                className="min-h-0 border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                variant="secondary"
                disabled={cantDelete || tableBusy || rowDeleteBusy}
                title={
                  isSelf
                    ? "Нельзя удалить свою учётную запись"
                    : isRoot
                      ? "Нельзя удалить пользователя root"
                      : undefined
                }
                loading={rowDeleteBusy}
                onClick={() => setDeleteTarget(u)}
              >
                Удалить
              </Button>
            </div>
          );
        },
      },
    ],
    [roleDraft, updateUser, deleteUser, onForbidden, show, myUserId, tableBusy]
  );

  const listEmpty = !isLoading && (users?.length ?? 0) === 0;
  const filterEmpty =
    !isLoading && (users?.length ?? 0) > 0 && filteredUsers.length === 0;

  return (
    <Page
      title="Пользователи"
      description="Роли platform (user / admin / root). Удаление — soft delete; себя и root удалить нельзя."
    >
      <div className="space-y-4">
        {banner}
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Input
              id="users-search"
              label="Поиск по email"
              placeholder="name@company.com"
              value={searchRaw}
              disabled={!!error}
              onChange={(e) => setSearchRaw(e.target.value)}
            />
            <div>
              <label
                htmlFor="users-filter-role"
                className="mb-1 block text-xs font-medium text-neutral-600"
              >
                Роль
              </label>
              <select
                id="users-filter-role"
                className={selectClass + " w-full max-w-none"}
                value={roleFilter}
                disabled={!!error}
                onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
              >
                <option value="all">Все роли</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {error ? (
          <ErrorState
            message={error instanceof Error ? error.message : "Ошибка загрузки"}
            onRetry={() => void refetch()}
          />
        ) : isLoading && !users ? (
          <DataTable<AdminUserRow>
            columns={columns}
            rows={[]}
            getRowId={() => "—"}
            isLoading
            loadingMode="skeleton"
            skeletonRows={10}
            emptyTitle="—"
          />
        ) : listEmpty ? (
          <EmptyState title="Нет пользователей" description="Пока нет учётных записей." />
        ) : filterEmpty ? (
          <EmptyState
            title="Ничего не найдено"
            description="Измените поиск или фильтр роли."
          />
        ) : (
          <div className={tableBusy ? "pointer-events-none opacity-70" : undefined}>
            <DataTable
              columns={columns}
              rows={filteredUsers}
              getRowId={(u) => u.id}
              isLoading={false}
              loadingMode="skeleton"
              emptyTitle="Нет данных"
            />
          </div>
        )}

        <AdminConfirmDialog
          open={deleteTarget != null}
          title="Удалить пользователя?"
          description={
            deleteTarget
              ? `Учётная запись ${deleteTarget.email} будет деактивирована (soft delete).`
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
              await deleteUser.mutateAsync(deleteTarget.id);
              show("Пользователь удалён");
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
