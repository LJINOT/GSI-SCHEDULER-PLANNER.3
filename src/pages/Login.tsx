import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

const MAX_ATTEMPTS = 5;
const LOCK_SECONDS = 59;
const LOCK_KEY = "gsi-login-lock-until";
const ATTEMPTS_KEY = "gsi-login-attempts";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [attempts, setAttempts] = useState<number>(() => Number(localStorage.getItem(ATTEMPTS_KEY) || 0));
  const [lockLeft, setLockLeft] = useState(0);
  const navigate = useNavigate();
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const until = Number(localStorage.getItem(LOCK_KEY) || 0);
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setLockLeft(left);
      if (left === 0 && until) {
        localStorage.removeItem(LOCK_KEY);
        localStorage.removeItem(ATTEMPTS_KEY);
        setAttempts(0);
      }
    };
    tick();
    timer.current = window.setInterval(tick, 1000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, []);

  const locked = lockLeft > 0;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (locked) return;

    const nextErrors: typeof errors = {};
    if (!email.trim()) nextErrors.email = "Email is required";
    if (!password) nextErrors.password = "Password is required";
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return; }
    setErrors({});

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      const next = attempts + 1;
      setAttempts(next);
      localStorage.setItem(ATTEMPTS_KEY, String(next));
      if (next >= MAX_ATTEMPTS) {
        const until = Date.now() + LOCK_SECONDS * 1000;
        localStorage.setItem(LOCK_KEY, String(until));
        setLockLeft(LOCK_SECONDS);
        setErrors({ form: `Too many failed attempts. Please wait ${LOCK_SECONDS} seconds before trying again.` });
      } else {
        setErrors({ form: `Invalid login credentials. ${MAX_ATTEMPTS - next} attempt${MAX_ATTEMPTS - next !== 1 ? "s" : ""} left.` });
      }
    } else {
      localStorage.removeItem(ATTEMPTS_KEY);
      localStorage.removeItem(LOCK_KEY);
      try { const u = (await supabase.auth.getUser()).data.user; if (u) localStorage.setItem("gsi-auth-uid", u.id); } catch {}
      navigate("/");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md animate-fade-in">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <img src="/favicon.ico" alt="GSI Schedule Planner" className="h-10 w-10 rounded-full" />
          </div>
          <CardTitle className="font-display text-2xl">Welcome back</CardTitle>
          <CardDescription>Sign in to GSI Schedule Planner</CardDescription>
        </CardHeader>
        <form onSubmit={handleLogin} noValidate>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (errors.email) setErrors(p => ({ ...p, email: undefined })); }}
                placeholder="you@example.com"
                aria-invalid={!!errors.email}
                className={errors.email ? "border-destructive focus-visible:ring-destructive" : undefined}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); if (errors.password) setErrors(p => ({ ...p, password: undefined })); }}
                placeholder="••••••••"
                aria-invalid={!!errors.password}
                className={errors.password ? "border-destructive focus-visible:ring-destructive" : undefined}
              />
              {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
            </div>
            {locked ? (
              <p className="text-sm text-destructive text-center">
                Too many failed attempts. Try again in {lockLeft}s.
              </p>
            ) : errors.form ? (
              <p className="text-sm text-destructive text-center">{errors.form}</p>
            ) : null}
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={loading || locked}>
              {locked ? `Locked (${lockLeft}s)` : loading ? "Signing in..." : "Sign in"}
            </Button>
            <div className="flex justify-between w-full text-sm">
              <Link to="/forgot-password" className="text-muted-foreground hover:text-primary">Forgot password?</Link>
              <Link to="/signup" className="text-muted-foreground hover:text-primary">Create account</Link>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
