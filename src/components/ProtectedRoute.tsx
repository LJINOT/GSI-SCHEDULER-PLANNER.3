import { syncTimezoneFromProfile } from "@/lib/date-utils";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
        if (session?.user?.id) {
          try { localStorage.setItem("gsi-auth-uid", session.user.id); } catch {}
          supabase.from("profiles").select("timezone").eq("id", session.user.id).single()
            .then(({ data }) => { if (data?.timezone) syncTimezoneFromProfile(data.timezone); });
        } else {
          try {
            localStorage.removeItem("gsi-auth-uid");
            // Drop any unscoped leftovers; scoped keys use uid prefix and stay isolated
            ["gsi-cache:schedule-blocks", "gsi-cache:adaptive-schedule", "gsi-cache:smart-picks", "gsi-cache:today"].forEach((k) => {
              try { localStorage.removeItem(k); } catch {}
            });
          } catch {}
        };
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
        if (session?.user?.id) {
          try { localStorage.setItem("gsi-auth-uid", session.user.id); } catch {}
          supabase.from("profiles").select("timezone").eq("id", session.user.id).single()
            .then(({ data }) => { if (data?.timezone) syncTimezoneFromProfile(data.timezone); });
        } else {
          try {
            localStorage.removeItem("gsi-auth-uid");
            // Drop any unscoped leftovers; scoped keys use uid prefix and stay isolated
            ["gsi-cache:schedule-blocks", "gsi-cache:adaptive-schedule", "gsi-cache:smart-picks", "gsi-cache:today"].forEach((k) => {
              try { localStorage.removeItem(k); } catch {}
            });
          } catch {}
        };
    });
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
