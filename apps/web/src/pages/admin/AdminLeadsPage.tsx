import { useMemo, useState } from "react";
import {
  type AdminLeadConversationDetail,
  type AdminLeadListRow,
  type AdminLeadMessage,
  useAdminLead,
  useAdminLeads,
} from "../../api/admin";
import { useAdminForbiddenRedirect } from "../../hooks/useAdminForbiddenRedirect";
import { ApiError } from "../../lib/apiClient";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  DataTable,
  type DataTableColumn,
  ErrorState,
  Page,
  cn,
} from "../../components/ui";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function roleLabel(role: string): string {
  if (role === "user") return "Клиент";
  if (role === "assistant") return "Ассистент";
  return role;
}

const STATUS_LABELS: Record<string, string> = {
  NEW: "Новый",
  CONTACTED: "В работе",
  QUALIFIED: "Квалифицирован",
  WON: "Успех",
  LOST: "Потерян",
  CLOSED: "Закрыт",
};

const STATUS_BADGE: Record<string, string> = {
  NEW: "bg-slate-100 text-slate-800 ring-1 ring-slate-200/80",
  CONTACTED: "bg-sky-100 text-sky-900 ring-1 ring-sky-200/80",
  QUALIFIED: "bg-violet-100 text-violet-900 ring-1 ring-violet-200/80",
  WON: "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200/80",
  LOST: "bg-red-100 text-red-900 ring-1 ring-red-200/80",
  CLOSED: "bg-neutral-200 text-neutral-800 ring-1 ring-neutral-300/80",
};

function statusBadgeClass(status: string): string {
  return STATUS_BADGE[status] ?? "bg-neutral-100 text-neutral-800 ring-1 ring-neutral-200/80";
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function formatLeadPhone(phone: string | null): string {
  if (phone == null || String(phone).trim() === "") {
    return "—";
  }
  const d = String(phone).replace(/\D/g, "");
  if (d.length === 11 && d[0] === "7") {
    return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
  }
  if (d.length === 10) {
    return `${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8, 10)}`;
  }
  return d || phone;
}

function truncatePreview(text: string | null, max: number): string {
  if (text == null || text.trim() === "") {
    return "—";
  }
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max)}…`;
}

function LeadStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-2 py-0.5 text-xs font-semibold",
        statusBadgeClass(status)
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

export function AdminLeadsPage() {
  const onForbidden = useAdminForbiddenRedirect();
  const { data: rows, isLoading, error, refetch } = useAdminLeads();
  const [openId, setOpenId] = useState<string | null>(null);
  const [quickPreview, setQuickPreview] = useState<AdminLeadListRow | null>(null);
  const detailQ = useAdminLead(openId);

  const columns = useMemo<DataTableColumn<AdminLeadListRow>[]>(
    () => [
      {
        id: "created",
        header: "Создан",
        cell: (r) => (
          <span className="text-xs text-neutral-500">{formatDate(r.createdAt)}</span>
        ),
      },
      {
        id: "org",
        header: "Организация",
        cell: (r) => r.organization?.name ?? "—",
      },
      {
        id: "name",
        header: "Имя",
        cell: (r) => <span className="font-medium">{r.name}</span>,
      },
      {
        id: "phone",
        header: "Телефон",
        cell: (r) => (
          <span className="font-mono text-xs">{formatLeadPhone(r.phone)}</span>
        ),
      },
      {
        id: "status",
        header: "Статус",
        cell: (r) => <LeadStatusBadge status={r.status} />,
      },
      {
        id: "preview",
        header: "Превью",
        className: "max-w-[220px]",
        cell: (r) => (
          <span className="line-clamp-2 text-xs text-neutral-600" title={r.firstMessage ?? ""}>
            {truncatePreview(r.firstMessage, 96)}
          </span>
        ),
      },
      {
        id: "action",
        header: "",
        className: "w-[120px]",
        cell: (r) => (
          <Button
            type="button"
            variant="secondary"
            className="text-xs"
            onClick={(e) => {
              e.stopPropagation();
              setOpenId(r.id);
            }}
          >
            Диалог
          </Button>
        ),
      },
    ],
    []
  );

  if (error instanceof ApiError && error.status === 403) {
    onForbidden(error);
  }

  return (
    <Page title="Лиды" description="Заявки из виджета и чатов: статус, контакты, переписка.">
      {error && !(error instanceof ApiError && error.status === 403) ? (
        <ErrorState
          message={
            error instanceof ApiError
              ? `Не удалось загрузить лиды: ${error.message}`
              : "Не удалось загрузить лиды"
          }
          onRetry={() => void refetch()}
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows ?? []}
            getRowId={(r) => r.id}
            isLoading={isLoading}
            emptyTitle="Лидов пока нет"
            emptyDescription="Когда посетители напишут в виджет, записи появятся здесь."
            onRowClick={(r) =>
              setQuickPreview((p) => (p?.id === r.id ? null : r))
            }
            getRowClassName={(r) =>
              quickPreview?.id === r.id ? "bg-amber-50/90" : undefined
            }
          />

          {quickPreview && (
            <Card className="mt-4 border-amber-200/80 bg-amber-50/30">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-neutral-900">
                    Быстрый просмотр · {quickPreview.name}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <LeadStatusBadge status={quickPreview.status} />
                    <Button
                      type="button"
                      variant="secondary"
                      className="text-xs"
                      onClick={() => {
                        setOpenId(quickPreview.id);
                        setQuickPreview(null);
                      }}
                    >
                      Полный диалог
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-xs"
                      onClick={() => setQuickPreview(null)}
                    >
                      Свернуть
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
                  <span className="font-mono">{formatLeadPhone(quickPreview.phone)}</span>
                  <span>{quickPreview.organization?.name ?? "—"}</span>
                </div>
              </CardHeader>
              <CardContent className="border-t border-amber-100 pt-4">
                <p className="whitespace-pre-wrap text-sm text-neutral-800">
                  {quickPreview.firstMessage?.trim()
                    ? quickPreview.firstMessage
                    : "Первое сообщение ещё не зафиксировано."}
                </p>
              </CardContent>
            </Card>
          )}

          {openId && (
            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-neutral-900">
                  Переписка
                </h2>
                <Button type="button" variant="ghost" onClick={() => setOpenId(null)}>
                  Закрыть
                </Button>
              </div>

              {detailQ.isLoading && (
                <p className="text-sm text-neutral-500">Загрузка…</p>
              )}
              {detailQ.error && (
                <ErrorState
                  message={
                    detailQ.error instanceof ApiError
                      ? `Не удалось загрузить диалог: ${detailQ.error.message}`
                      : "Не удалось загрузить диалог"
                  }
                  onRetry={() => void detailQ.refetch()}
                />
              )}
              {detailQ.data && (
                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-700">
                        <span>
                          <span className="text-neutral-500">Имя: </span>
                          {detailQ.data.name}
                        </span>
                        <span>
                          <span className="text-neutral-500">Телефон: </span>
                          <span className="font-mono">
                            {formatLeadPhone(detailQ.data.phone)}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-neutral-500">Статус: </span>
                          <LeadStatusBadge status={detailQ.data.status} />
                        </span>
                        <span>
                          <span className="text-neutral-500">Источник: </span>
                          {detailQ.data.source}
                        </span>
                      </div>
                    </CardHeader>
                  </Card>

                  {detailQ.data.conversations.map((c: AdminLeadConversationDetail) => (
                    <Card key={c.id}>
                      <CardHeader>
                        <div className="text-sm font-medium text-neutral-900">
                          Диалог · {c.status} · {c.source}
                        </div>
                        <div className="text-xs text-neutral-500">
                          {formatDate(c.createdAt)} · id: {c.id}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3 border-t border-neutral-100 pt-4">
                        {c.messages.length === 0 ? (
                          <p className="text-sm text-neutral-500">Сообщений нет</p>
                        ) : (
                          c.messages.map((m: AdminLeadMessage) => (
                            <div
                              key={m.id}
                              className="rounded-lg border border-neutral-100 bg-neutral-50/80 px-3 py-2"
                            >
                              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-xs text-neutral-500">
                                <span className="font-medium text-neutral-700">
                                  {roleLabel(m.role)}
                                </span>
                                <span>{formatDate(m.createdAt)}</span>
                              </div>
                              <pre className="whitespace-pre-wrap break-words font-sans text-sm text-neutral-900">
                                {m.content}
                              </pre>
                            </div>
                          ))
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Page>
  );
}
