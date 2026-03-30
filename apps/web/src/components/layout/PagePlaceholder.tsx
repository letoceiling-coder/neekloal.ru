type PagePlaceholderProps = {
  title: string;
  description?: string;
};

export function PagePlaceholder({ title, description }: PagePlaceholderProps) {
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
        {title}
      </h2>
      <p className="text-sm text-neutral-500">
        {description ?? "Заглушка — подключение API позже."}
      </p>
    </div>
  );
}
