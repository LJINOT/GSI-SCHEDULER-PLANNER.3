```tsx
import {
  LayoutDashboard,
  ListTodo,
  CalendarDays,
  Clock,
  Target,
  Sun,
  CalendarRange,
  CheckCircle2,
  LogOut,
  Lightbulb,
  RefreshCw,
  Focus,
  AlertTriangle,
  BarChart3,
  User,
  Settings,
  Palette,
  HelpCircle,
  ChevronDown,
  FolderKanban,
  Sparkles,
  Code2,
} from "lucide-react";

import { NavLink } from "@/components/NavLink";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

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
  {
    title: "Smart Suggestions",
    url: "/smart-suggestions",
    icon: Lightbulb,
  },
  {
    title: "Adaptive Scheduling",
    url: "/adaptive-scheduling",
    icon: RefreshCw,
  },
  {
    title: "Focus Mode",
    url: "/focus-mode",
    icon: Focus,
  },
  {
    title: "Deadline Risk Detector",
    url: "/deadline-risk",
    icon: AlertTriangle,
  },
  {
    title: "Productivity Insights",
    url: "/productivity-insights",
    icon: BarChart3,
  },
];

const settingsItems = [
  { title: "Profile", url: "/settings/profile", icon: User },
  { title: "General", url: "/settings/general", icon: Settings },
  {
    title: "Personalization",
    url: "/settings/personalization",
    icon: Palette,
  },
  {
    title: "Algorithm Insights",
    url: "/settings/algorithm-insights",
    icon: Sparkles,
  },
  {
    title: "Help / About",
    url: "/settings/help",
    icon: HelpCircle,
  },
];

const developerItem = {
  title: "Developer Mode",
  url: "/settings/developer",
  icon: Code2,
};

/*
 * Navigation styles
 *
 * Important:
 * The collapsed state uses:
 *   - justify-center
 *   - px-0
 *   - gap-0
 *
 * This prevents the 48px sidebar from trying to fit
 * expanded navigation spacing.
 */
const navBase =
  "relative flex h-8 w-full items-center rounded-lg px-2.5 text-sm transition-colors hover:bg-sidebar-accent/70 " +
  "gap-2 " +
  "group-data-[collapsible=icon]:justify-center " +
  "group-data-[collapsible=icon]:gap-0 " +
  "group-data-[collapsible=icon]:px-0";

const navActive =
  "bg-sidebar-accent text-sidebar-accent-foreground font-semibold " +
  "before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 " +
  "before:h-5 before:w-[3px] before:rounded-full before:bg-primary";

const navActiveAi =
  "bg-[#F5F3FF] text-ai font-semibold dark:bg-ai/15 " +
  "before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 " +
  "before:h-5 before:w-[3px] before:rounded-full before:bg-ai";

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
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, avatar_url")
        .eq("id", user.id)
        .single();

      if (profile?.full_name) {
        setDisplayName(profile.full_name);
      }

      const path = (profile as any)?.avatar_url as string | null;

      if (path) {
        const { data: signed } = await supabase.storage
          .from("avatars")
          .createSignedUrl(path, 60 * 60 * 24 * 7);

        if (signed?.signedUrl) {
          setAvatarUrl(signed.signedUrl);
        }
      }
    };

    load();

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        url: string | null;
      };

      setAvatarUrl(detail?.url ?? null);
    };

    window.addEventListener("avatar-updated", handler);

    return () => {
      window.removeEventListener("avatar-updated", handler);
    };
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

  /*
   * Standard navigation group
   */
  const renderGroup = (
    label: string,
    items: typeof managementItems,
    opts?: { ai?: boolean }
  ) => (
    <SidebarGroup>
      <SidebarGroupLabel
        className={cn(
          opts?.ai && "text-ai/80",
          "group-data-[collapsible=icon]:hidden"
        )}
      >
        {label}
      </SidebarGroupLabel>

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
                    className={cn(
                      "h-4 w-4 shrink-0",
                      opts?.ai && "text-ai"
                    )}
                  />

                  {!collapsed && (
                    <span className="min-w-0 flex-1 truncate">
                      {item.title}
                    </span>
                  )}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  /*
   * Collapsible navigation group
   */
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
              "flex w-full items-center justify-between rounded-md px-2 py-1.5",
              "text-xs font-semibold uppercase tracking-wider",
              "text-muted-foreground hover:text-foreground",
              "group-data-[collapsible=icon]:hidden",
              opts?.ai && "text-ai/70 hover:text-ai"
            )}
          >
            <span>{label}</span>

            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                open && "rotate-180"
              )}
            />
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
                      activeClassName={
                        opts?.ai ? navActiveAi : navActive
                      }
                    >
                      <item.icon
                        className={cn(
                          "h-4 w-4 shrink-0",
                          opts?.ai && "text-ai"
                        )}
                      />

                      {!collapsed && (
                        <span className="min-w-0 flex-1 truncate">
                          {item.title}
                        </span>
                      )}
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
    <Sidebar
      collapsible="icon"
      className="border-r border-sidebar-border bg-sidebar"
    >
      {/* =========================================================
          HEADER / LOGO
      ========================================================== */}
      <SidebarHeader
        className={cn(
          "p-4",
          "group-data-[collapsible=icon]:p-2"
        )}
      >
        <NavLink
          to="/"
          className={cn(
            "flex items-center gap-2.5 group",
            "group-data-[collapsible=icon]:justify-center",
            "group-data-[collapsible=icon]:gap-0"
          )}
        >
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              "bg-primary/10 ring-1 ring-primary/20"
            )}
          >
            <img
              src="/favicon.ico"
              alt="GSI Logo"
              className="h-5 w-5 rounded-full"
            />
          </div>

          {!collapsed && (
            <span className="min-w-0 truncate font-display text-base font-bold tracking-tight text-foreground transition-colors group-hover:text-primary">
              GSI Schedule Planner
            </span>
          )}
        </NavLink>
      </SidebarHeader>

      <Separator className="opacity-60" />

      {/* =========================================================
          CONTENT
      ========================================================== */}
      <SidebarContent className="gap-1">
        {/* Dashboard */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to="/"
                    end
                    className={navBase}
                    activeClassName={navActive}
                  >
                    <LayoutDashboard className="h-4 w-4 shrink-0" />

                    {!collapsed && (
                      <span className="min-w-0 flex-1 truncate">
                        Dashboard
                      </span>
                    )}
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

      {/* =========================================================
          FOOTER / PROFILE / LOGOUT
      ========================================================== */}
      <SidebarFooter
        className={cn(
          "p-3",
          "group-data-[collapsible=icon]:p-2"
        )}
      >
        <Separator className="mb-3 opacity-60" />

        {/* Profile */}
        <NavLink
          to="/settings/profile"
          className={cn(
            "flex w-full items-center rounded-lg p-1.5",
            "gap-2.5 transition-colors hover:bg-sidebar-accent",
            "group-data-[collapsible=icon]:justify-center",
            "group-data-[collapsible=icon]:gap-0",
            "group-data-[collapsible=icon]:p-0"
          )}
        >
          <Avatar
            className={cn(
              "h-9 w-9 shrink-0 ring-2 ring-primary/15",
              "group-data-[collapsible=icon]:h-8",
              "group-data-[collapsible=icon]:w-8"
            )}
          >
            {avatarUrl && (
              <img
                src={avatarUrl}
                alt="Profile"
                className="h-full w-full object-cover"
              />
            )}

            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>

          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {displayName}
              </p>

              <p className="truncate text-xs text-muted-foreground">
                View profile
              </p>
            </div>
          )}
        </NavLink>

        {/* Logout */}
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "mt-2 w-full text-muted-foreground hover:text-destructive",
            "justify-start",
            "group-data-[collapsible=icon]:justify-center",
            "group-data-[collapsible=icon]:px-0",
            "group-data-[collapsible=icon]:h-8",
            "group-data-[collapsible=icon]:w-8",
            "group-data-[collapsible=icon]:mx-auto"
          )}
          onClick={handleLogout}
          title={collapsed ? "Log out" : undefined}
        >
          <LogOut
            className={cn(
              "h-4 w-4 shrink-0",
              !collapsed && "mr-2"
            )}
          />

          {!collapsed && <span>Log out</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
```
