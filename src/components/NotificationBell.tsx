import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell, FolderKanban, CheckCircle2, Clock3, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { formatDateTime, countdown, formatPH } from "@/lib/date-utils";

type Task = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  start_time: string | null;
  project_id: string | null;
};
type Project = { id: string; name: string; color: string };

function readKey(): string {
  try {
    const uid = localStorage.getItem("gsi-auth-uid") || "anon";
    return `gsi-notif-read:${uid}`;
  } catch {
    return "gsi-notif-read:anon";
  }
}

type Severity = "red" | "yellow" | "green";

type Notif = {
  key: string;
  to: string;
  title: string;
  detail: string;
  severity: Severity;
  isProject?: boolean;
  sort: number;
};

const SEVERITY = {
  red: {
    dot: "bg-destructive",
    ring: "border-l-4 border-destructive",
    text: "text-destructive",
    Icon: AlertTriangle,
    label: "Needs attention",
  },
  yellow: {
    dot: "bg-warning",
    ring: "border-l-4 border-warning",
    text: "text-warning",
    Icon: Clock3,
    label: "In progress",
  },
  green: {
    dot: "bg-success",
    ring: "border-l-4 border-success",
    text: "text-success",
    Icon: CheckCircle2,
    label: "Completed",
  },
} as const;

export function NotificationBell() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(readKey()) || "[]")); }
    catch { return new Set(); }
  });

  const persistRead = (next: Set<string>) => {
    setReadIds(new Set(next));
    localStorage.setItem(readKey(), JSON.stringify(Array.from(next)));
  };
  const markRead = (key: string) => {
    if (readIds.has(key)) return;
    const next = new Set(readIds); next.add(key); persistRead(next);
  };
  const markAllRead = (keys: string[]) => {
    const next = new Set(readIds); keys.forEach(k => next.add(k)); persistRead(next);
  };

  const fetchData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const [{ data: taskData }, { data: projectData }] = await Promise.all([
      supabase.from("tasks").select("id, title, status, due_date, start_time, project_id").eq("user_id", user.id).eq("archived", false),
      supabase.from("projects").select("id, name, color").eq("user_id", user.id).eq("archived", false),
    ]);
    setTasks(taskData || []);
    setProjects(projectData || []);
  };

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel("global-notif-bell")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, fetchData)
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, fetchData)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const now = new Date();
  const todayKey = formatPH(now, "yyyy-MM-dd");

  const taskNotifs: Notif[] = tasks.map((t) => {
    const key = `task:${t.id}:${t.status}`;
    const to = `/tasks?task=${t.id}${t.project_id ? `&project=${t.project_id}` : ""}`;
    if (t.status === "done") {
      return { key, to, title: t.title, detail: "Marked done", severity: "green" as const, sort: 3 };
    }
    if (t.status === "in_progress") {
      return {
        key, to, title: t.title,
        detail: t.due_date ? `In progress · ${countdown(t.due_date, now)}` : "In progress now",
        severity: "yellow" as const, sort: 2,
      };
    }
    const overdue = t.due_date ? new Date(t.due_date) < now : false;
    const dueToday = t.due_date ? formatPH(t.due_date, "yyyy-MM-dd") === todayKey : false;
    const urgent = overdue || dueToday;
    return {
      key, to, title: t.title,
      detail: t.due_date
        ? `${overdue ? "Overdue" : "Due"} ${formatDateTime(t.due_date)}`
        : t.start_time ? `Starts ${formatDateTime(t.start_time)}` : "To do — no date set",
      severity: (urgent ? "red" : "yellow") as Severity,
      sort: urgent ? 0 : 1,
    };
  });

  const projectNotifs: Notif[] = projects.map((p) => {
    const pt = tasks.filter(t => t.project_id === p.id);
    const done = pt.filter(t => t.status === "done").length;
    const inProg = pt.filter(t => t.status === "in_progress").length;
    const todo = pt.length - done - inProg;
    const severity: Severity = pt.length > 0 && done === pt.length ? "green" : inProg > 0 ? "yellow" : "red";
    return {
      key: `project:${p.id}:activity`,
      to: `/projects?project=${p.id}`,
      title: p.name,
      detail: `${done} done · ${inProg} in progress · ${todo} to do`,
      severity,
      isProject: true,
      sort: severity === "red" ? 0 : severity === "yellow" ? 2 : 3,
    };
  }).filter(n => tasks.some(t => t.project_id === n.key.split(":")[1]));

  const all = [...taskNotifs, ...projectNotifs]
    .filter(n => !readIds.has(n.key))
    .sort((a, b) => a.sort - b.sort);

  const counts = {
    red: all.filter(n => n.severity === "red").length,
    yellow: all.filter(n => n.severity === "yellow").length,
    green: all.filter(n => n.severity === "green").length,
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          {all.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {all.length > 99 ? "99+" : all.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] sm:w-96 p-0">
        <div className="px-4 py-3 border-b flex items-start justify-between gap-2">
          <div>
            <p className="font-display font-semibold">Notifications</p>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="text-[10px] text-destructive border-destructive/40">{counts.red} urgent</Badge>
              <Badge variant="outline" className="text-[10px] text-warning border-warning/40">{counts.yellow} ongoing</Badge>
              <Badge variant="outline" className="text-[10px] text-success border-success/40">{counts.green} done</Badge>
            </div>
          </div>
          {all.length > 0 && (
            <Button variant="ghost" size="sm" className="text-xs h-7"
              onClick={() => markAllRead(all.map(n => n.key))}>
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-[24rem] overflow-y-auto p-2 space-y-1">
          {all.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">You're all caught up</p>
          ) : all.map((n) => {
            const s = SEVERITY[n.severity];
            const Icon = n.isProject ? FolderKanban : s.Icon;
            return (
              <Link
                key={n.key}
                to={n.to}
                onClick={() => { markRead(n.key); setOpen(false); }}
                className={`flex items-start gap-2.5 p-2.5 rounded-md bg-accent/20 hover:bg-accent/50 transition-colors ${s.ring}`}
              >
                <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${s.text}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{n.title}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{n.detail}</p>
                </div>
                <span className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${s.dot}`} aria-label={s.label} />
              </Link>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
