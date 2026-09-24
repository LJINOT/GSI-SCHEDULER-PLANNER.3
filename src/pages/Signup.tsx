import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { PasswordField } from "@/components/PasswordField";
import { validatePassword } from "@/lib/validation";

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);

  const navigate = useNavigate();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    const pwError = validatePassword(password);

    if (pwError) {
      toast.error(pwError);
      return;
    }

    if (!fullName.trim()) {
      toast.error("Full name is required.");
      return;
    }

    if (!email.trim()) {
      toast.error("Email is required.");
      return;
    }

    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          full_name: fullName.trim(),
        },
      },
    });

    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    /*
     * When email confirmation is enabled,
     * Supabase normally returns a user without an active session.
     */
    if (data.user && !data.session) {
      setRegistered(true);
      toast.success("Confirmation email sent!");
      return;
    }

    /*
     * Fallback for projects where email confirmation
     * is disabled.
     */
    if (data.session) {
      navigate("/");
      return;
    }

    setRegistered(true);
  };

  const handleResendConfirmation = async () => {
    if (!email.trim()) {
      toast.error("Please enter your email address.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("A new confirmation email has been sent.");
  };

  /*
   * Confirmation screen
   */
  if (registered) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md animate-fade-in">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <img
                src="/favicon.ico"
                alt="GSI Schedule Planner"
                className="h-10 w-10 rounded-full"
              />
            </div>

            <CardTitle className="font-display text-2xl">
              Check your email
            </CardTitle>

            <CardDescription>
              We sent a confirmation link to:
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 text-center">
            <p className="font-medium break-all">
              {email}
            </p>

            <p className="text-sm text-muted-foreground">
              Open your email and click the confirmation link
              before signing in to GSI Schedule Planner.
            </p>

            <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
              <p className="text-sm">
                Didn't receive the email?
              </p>

              <Button
                type="button"
                variant="outline"
                className="w-full mt-3"
                onClick={handleResendConfirmation}
                disabled={loading}
              >
                {loading
                  ? "Sending..."
                  : "Resend confirmation email"}
              </Button>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col gap-3">
            <Button
              type="button"
              className="w-full"
              onClick={() => navigate("/login")}
            >
              Go to sign in
            </Button>

            <Link
              to="/login"
              className="text-sm text-muted-foreground hover:text-primary"
            >
              Already confirmed? Sign in
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  /*
   * Normal signup form
   */
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md animate-fade-in">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <img
              src="/favicon.ico"
              alt="GSI Schedule Planner"
              className="h-10 w-10 rounded-full"
            />
          </div>

          <CardTitle className="font-display text-2xl">
            Create account
          </CardTitle>

          <CardDescription>
            Get started with GSI Schedule Planner
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSignup}>
          <CardContent className="space-y-4">
            {/* Full Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>

              <Input
                id="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="John Doe"
                required
              />
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>

              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            {/* Password */}
            <PasswordField
              value={password}
              onChange={setPassword}
              required
            />
          </CardContent>

          <CardFooter className="flex flex-col gap-3">
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !!validatePassword(password)}
            >
              {loading
                ? "Creating account..."
                : "Create account"}
            </Button>

            <Link
              to="/login"
              className="text-sm text-muted-foreground hover:text-primary"
            >
              Already have an account? Sign in
            </Link>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
