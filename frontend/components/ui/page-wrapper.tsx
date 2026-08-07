import { TopNav } from "@/components/conditional-navbar";

export const PageWrapper = ({
  children,
  description,
  title,
  actions,
}: {
  children?: React.ReactNode;
  description?: string;
  title?: string | React.ReactNode;
  actions?: React.ReactNode;
}) => {
  return (
    <div className="page-shell h-full border bg-background/50 border-border rounded-md overflow-hidden m-1 flex flex-col">
      <div className="page-shell-header border-b border-border px-2 py-1">
        <div className="flex justify-between items-center gap-2">
          <div className="items-center gap-2 min-w-0">
            {typeof title === "string" ? (
              <h1 className="page-shell-title text-sm font-medium text-foreground truncate">
                {title}
              </h1>
            ) : (
              title
            )}
            {description && (
              <p className="page-shell-description text-[10px] text-muted-foreground mt-0.5">
                {description}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {actions}
            <TopNav />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
};
