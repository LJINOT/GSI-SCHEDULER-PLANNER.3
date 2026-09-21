import {
  LayoutDashboard, ListTodo, CalendarDays, Clock, Target,
  Sun, CalendarRange, CheckCircle2, LogOut, Lightbulb, RefreshCw,
  Focus, AlertTriangle, BarChart3, User, Settings, Palette, HelpCircle,
  ChevronDown, FolderKanban, Sparkles, Code2,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarFooter, SidebarHeader, useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useState, useEffect } from "react";
import { useDevUnlock } from "@/hooks/use-dev-mode";
import { cn } from "@/lib/utils";

const managementItems = [
  { title: "Tasks", url: "/tasks", icon: ListTodo },
  { title: "Projects", url: "/projects", icon: FolderKanban },
  { title: "Calendar", url: "/calendar", icon: CalendarDays },
  { title: "Auto Schedule", url: "/auto-schedule", icon: Clock },
];

const referentialItems = [
  { title: "Priorities", url: "/priorities", icon: Target },
  { title: "Today AI Recommendation", url: "/today", icon: Sun },
  { title: "This Week", url: "/this-week", icon: CalendarRange },
  { title: "Completed", url: "/completed", icon: CheckCircle2 },
];

const smartFeatureItems = [
  { title: "Smart Suggestions", url: "/smart-suggestions", icon: Lightbulb },
  { title: "Adaptive Scheduling", url: "/adaptive-scheduling", icon: RefreshCw },
  { title: "Focus Mode", url: "/focus-mode", icon: Focus },
  { title: "Deadline Risk Detector", url: "/deadline-risk", icon: AlertTriangle },
  { title: "Productivity Insights", url: "/productivity-insights", icon: BarChart3 },
];

const settingsItems = [
  { title: "Profile", url: "/settings/profile", icon: User },
  { title: "General", url: "/settings/general", icon: Settings },
  { title: "Personalization", url: "/settings/personalization", icon: Palette },
  { title: "Algorithm Insights", url: "/settings/algorithm-insights", icon: Sparkles },
  { title: "Help / About", url: "/settings/help", icon: HelpCircle },
];

const developerItem = { title: "Developer Mode", url: "/settings/developer", icon: Code2 };

const navBase =
  "relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-sidebar-accent/70";
const navActive =
  "bg-sidebar-accent text-sidebar-accent-foreground font-semibold before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[3px] before:rounded-full before:bg-primary";
const navActiveAi =
  "bg-[#F5F3FF] text-ai font-semibold dark:bg-ai/15 before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[3px] before:rounded-full before:bg-ai";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const navigate = useNavigate();
  const { unlocked } = useDevUnlock();
  const visibleSettingsItems = unlocked
    ? [...settingsItems.slice(0, 4), developerItem, settingsItems[4]]
    : settingsItems;
  const [smartOpen, setSmartOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>("User");

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, avatar_url")
        .eq("id", user.id)
        .single();
      if (profile?.full_name) setDisplayName(profile.full_name);
      const path = (profile as any)?.avatar_url as string | null;
      if (path) {
        const { data: signed } = await supabase.storage
          .from("avatars")
          .createSignedUrl(path, 60 * 60 * 24 * 7);
        if (signed?.signedUrl) setAvatarUrl(signed.signedUrl);
      }
    };
    load();
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { url: string | null };
      setAvatarUrl(detail?.url ?? null);
    };
    window.addEventListener("avatar-updated", handler);
    return () => window.removeEventListener("avatar-updated", handler);
  }, []);

  const initials = displayName
    ? displayName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "U";

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Logged out successfully");
    navigate("/login");
  };

  const renderGroup = (
    label: string,
    items: typeof managementItems,
    opts?: { ai?: boolean }
  ) => (
    <SidebarGroup>
      <SidebarGroupLabel className={cn(opts?.ai && "text-ai/80")}>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild>
                <NavLink
                  to={item.url}
                  end
                  className={navBase}
                  activeClassName={opts?.ai ? navActiveAi : navActive}
                >
                  <item.icon className={cn("h-4 w-4 shrink-0", opts?.ai && "text-ai")} />
                  {!collapsed && <span className="truncate">{item.title}</span>}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  const renderCollapsibleGroup = (
    label: string,
    items: typeof smartFeatureItems,
    open: boolean,
    setOpen: (v: boolean) => void,
    opts?: { ai?: boolean }
  ) => (
    <SidebarGroup>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground",
              opts?.ai && "text-ai/70 hover:text-ai"
            )}
          >
            <span>{label}</span>
            {!collapsed && (
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
              />
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end
                      className={navBase}
                      activeClassName={opts?.ai ? navActiveAi : navActive}
                    >
                      <item.icon
                        className={cn("h-4 w-4 shrink-0", opts?.ai && "text-ai")}
                      />
                      {!collapsed && <span className="truncate">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  );

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-sidebar">
      <SidebarHeader className="p-4">
        <NavLink to="/" className="flex items-center gap-2.5 group">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
            <img src="/favicon.ico" alt="GSI Logo" className="h-5 w-5 rounded-full" />
          </div>
          {!collapsed && (
            <span className="font-display text-base font-bold tracking-tight text-foreground group-hover:text-primary transition-colors">
              GSI Schedule Planner
            </span>
          )}
        </NavLink>
      </SidebarHeader>

      <Separator className="opacity-60" />

      <SidebarContent className="gap-1">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink to="/" end className={navBase} activeClassName={navActive}>
                    <LayoutDashboard className="h-4 w-4 shrink-0" />
                    {!collapsed && <span>Dashboard</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {renderGroup("Management", managementItems)}
        {renderGroup("Overview", referentialItems)}
        {renderCollapsibleGroup(
          "Smart Features",
          smartFeatureItems,
          smartOpen,
          setSmartOpen,
          { ai: true }
        )}
        {renderCollapsibleGroup(
          "Settings",
          visibleSettingsItems,
          settingsOpen,
          setSettingsOpen
        )}
      </SidebarContent>

      <SidebarFooter className="p-3">
        <Separator className="mb-3 opacity-60" />
        <NavLink
          to="/settings/profile"
          className="flex items-center gap-2.5 rounded-lg p-1.5 hover:bg-sidebar-accent transition-colors"
        >
          <Avatar className="h-9 w-9 ring-2 ring-primary/15">
            {avatarUrl && (
              <img src={avatarUrl} alt="Profile" className="h-full w-full object-cover" />
            )}
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{displayName}</p>
              <p className="text-xs text-muted-foreground">View profile</p>
            </div>
          )}
        </NavLink>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full justify-start text-muted-foreground hover:text-destructive"
          onClick={handleLogout}
        >
          <LogOut className="mr-2 h-4 w-4" />
          {!collapsed && "Log out"}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
