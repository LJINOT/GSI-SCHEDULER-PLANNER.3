import { ReactNode, useState } from "react";
import { ChevronDown, Code2 } from "lucide-react";
import { useDevMode } from "@/hooks/use-dev-mode";

/** Renders algorithm internals — only visible when Developer Mode is toggled on. */
export function DevPanel({
  title,
  subtitle,
  raw,
  children,
  defaultOpen = true,
}: {
  title: string;
  subtitle?: string;
  raw?: unknown;
  children?: ReactNode;
  defaultOpen?: boolean;
}) {
  const { devMode } = useDevMode();
  const [open, setOpen] = useState(defaultOpen);
  const [showRaw, setShowRaw] = useState(false);

  if (!devMode) return null;

  return (
    <div className="rounded-lg border border-dashed border-primary/40 bg-primary/[0.03]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
      >
        <Code2 className="h-4 w-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-primary">{title}</p>
          {subtitle && <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>}
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {children}
          {raw !== undefined && (
            <div>
              <button
                type="button"
                onClick={() => setShowRaw((s) => !s)}
                className="text-[11px] font-medium text-primary underline underline-offset-2"
              >
                {showRaw ? "Hide" : "Show"} raw algorithm output
              </button>
              {showRaw && (
                <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted p-3 text-[10px] leading-relaxed">
                  {JSON.stringify(raw, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DevStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-mono font-semibold">{value}</p>
    </div>
  );
}

export function DevBar({
  label,
  value,
  weight,
  max = 1,
}: {
  label: string;
  value: number;
  weight?: number;
  max?: number;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
        <span>
          {label}
          {weight !== undefined && ` × w=${weight.toFixed(3)}`}
        </span>
        <span>
          {value.toFixed(3)}
          {weight !== undefined && ` → ${(value * weight).toFixed(3)}`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
