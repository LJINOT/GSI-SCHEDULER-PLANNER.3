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

type NavItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
};

const managementItems: NavItem[] = [
  { title: "Tasks", url: "/tasks", icon: ListTodo },
  { title: "Projects", url: "/projects", icon: FolderKanban },
  { title: "Calendar", url: "/calendar", icon: CalendarDays },
  { title: "Auto Schedule", url: "/auto-schedule", icon: Clock },
];

const referentialItems: NavItem[] = [
  { title: "Priorities", url: "/priorities", icon: Target },
  { title: "Today AI Recommendation", url: "/today", icon: Sun },
  { title: "This Week", url: "/this-week", icon: CalendarRange },
  { title: "Completed", url: "/completed", icon: CheckCircle2 },
];

const smartFeatureItems: NavItem[] = [
  { title: "Smart Suggestions", url: "/smart-suggestions", icon: Lightbulb },
  { title: "Adaptive Scheduling", url: "/adaptive-scheduling", icon: RefreshCw },
  { title: "Focus Mode", url: "/focus-mode", icon: Focus },
  { title: "Deadline Risk Detector", url: "/deadline-risk", icon: AlertTriangle },
  { title: "Productivity Insights", url: "/productivity-insights", icon: BarChart3 },
];

const settingsItems: NavItem[] = [
  { title: "Profile", url: "/settings/profile", icon: User },
  { title: "General", url: "/settings/general", icon: Settings },
  { title: "Personalization", url: "/settings/personalization", icon: Palette },
  { title: "Algorithm Insights", url: "/settings/algorithm-insights", icon: Sparkles },
  { title: "Help / About", url: "/settings/help", icon: HelpCircle },
];

const developerItem: NavItem = {
  title: "Developer Mode",
  url: "/settings/developer",
  icon: Code2,
};

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

  // Section expand state — only used when sidebar is expanded
  const [smartOpen, setSmartOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>("User");

  // When collapsing, keep sections logically "open" so icon mode still lists every link
  useEffect(() => {
    if (collapsed) {
      setSmartOpen(true);
      setSettingsOpen(true);
    }
  }, [collapsed]);

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, avatar_url")
        .eq("id", user.id)
        .single();
      if (profile?.full_name) setDisplayName(profile.full_name);
      const path = (profile as { avatar_url?: string | null } | null)?.avatar_url;
      if (path) {
        const { data: signed } = await supabase.storage
          .from("avatars")
          .createSignedUrl(path, 60 * 60 * 24 * 7);
        if (signed?.signedUrl) setAvatarUrl(signed.signedUrl);
      }
    };
    void load();
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { url: string | null };
      setAvatarUrl(detail?.url ?? null);
    };
    window.addEventListener("avatar-updated", handler);
    return () => window.removeEventListener("avatar-updated", handler);
  }, []);

  const initials = displayName
    ? displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U";

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Logged out successfully");
    navigate("/login");
  };

  const renderMenuItems = (items: NavItem[], opts?: { ai?: boolean }) => (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.title}>
          <SidebarMenuButton asChild tooltip={item.title}>
            <NavLink
              to={item.url}
              end
              className={cn(navBase, collapsed && "justify-center px-0")}
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
  );

  const renderGroup = (
    label: string,
    items: NavItem[],
    opts?: { ai?: boolean },
  ) => (
    <SidebarGroup className={cn(collapsed && "p-1")}>
      {!collapsed && (
        <SidebarGroupLabel className={cn(opts?.ai && "text-ai/80")}>
          {label}
        </SidebarGroupLabel>
      )}
      <SidebarGroupContent>{renderMenuItems(items, opts)}</SidebarGroupContent>
    </SidebarGroup>
  );

  /**
   * Expanded: collapsible section.
   * Collapsed (icon mode): always show every item — nested Collapsible would
   * hide children and break navigation.
   */
  const renderCollapsibleGroup = (
    label: string,
    items: NavItem[],
    open: boolean,
    setOpen: (v: boolean) => void,
    opts?: { ai?: boolean },
  ) => {
    if (collapsed) {
      return (
        <SidebarGroup className="p-1">
          <SidebarGroupContent>{renderMenuItems(items, opts)}</SidebarGroupContent>
        </SidebarGroup>
      );
    }

    return (
      <SidebarGroup>
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground",
                opts?.ai && "text-ai/70 hover:text-ai",
              )}
            >
              <span>{label}</span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 transition-transform",
                  open && "rotate-180",
                )}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-none">
            <SidebarGroupContent>
              {renderMenuItems(items, opts)}
            </SidebarGroupContent>
          </CollapsibleContent>
        </Collapsible>
      </SidebarGroup>
    );
  };

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-sidebar-border bg-sidebar"
    >
      <SidebarHeader className={cn("p-4", collapsed && "p-2")}>
        <NavLink
          to="/"
          className={cn(
            "flex items-center gap-2.5 group",
            collapsed && "justify-center",
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
            <img
              src="/favicon.ico"
              alt="GSI Logo"
              className="h-5 w-5 rounded-full"
            />
          </div>
          {!collapsed && (
            <span className="font-display text-base font-bold tracking-tight text-foreground group-hover:text-primary transition-colors">
              GSI Schedule Planner
            </span>
          )}
        </NavLink>
      </SidebarHeader>

      <Separator className="opacity-60" />

      {/* Allow scroll in icon mode so long nav is still reachable */}
      <SidebarContent className="gap-1 group-data-[collapsible=icon]:overflow-y-auto group-data-[collapsible=icon]:overflow-x-hidden">
        <SidebarGroup className={cn(collapsed && "p-1")}>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Dashboard">
                  <NavLink
                    to="/"
                    end
                    className={cn(navBase, collapsed && "justify-center px-0")}
                    activeClassName={navActive}
                  >
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
          { ai: true },
        )}
        {renderCollapsibleGroup(
          "Settings",
          visibleSettingsItems,
          settingsOpen,
          setSettingsOpen,
        )}
      </SidebarContent>

      <SidebarFooter className={cn("p-3", collapsed && "p-2")}>
        <Separator className="mb-3 opacity-60" />
        <NavLink
          to="/settings/profile"
          className={cn(
            "flex items-center gap-2.5 rounded-lg p-1.5 hover:bg-sidebar-accent transition-colors",
            collapsed && "justify-center p-1",
          )}
          title={displayName}
        >
          <Avatar className="h-9 w-9 shrink-0 ring-2 ring-primary/15">
            {avatarUrl && (
              <img
                src={avatarUrl}
                alt="Profile"
                className="h-full w-full object-cover"
              />
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
          className={cn(
            "mt-2 w-full text-muted-foreground hover:text-destructive",
            collapsed ? "justify-center px-0" : "justify-start",
          )}
          onClick={handleLogout}
          title="Log out"
        >
          <LogOut className={cn("h-4 w-4", !collapsed && "mr-2")} />
          {!collapsed && "Log out"}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
