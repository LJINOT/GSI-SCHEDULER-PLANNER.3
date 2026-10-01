import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

import { Eye, EyeOff, Loader2 } from "lucide-react";

export default function Signup() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const validatePassword = () => {
    if (password.length < 8) {
      return "Password must contain at least 8 characters.";
    }

    if (!/[A-Z]/.test(password)) {
      return "Password must contain at least one uppercase letter.";
    }

    if (!/[a-z]/.test(password)) {
      return "Password must contain at least one lowercase letter.";
    }

    if (!/[0-9]/.test(password)) {
      return "Password must contain at least one number.";
    }

    return "";
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    setError("");
    setMessage("");

    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    if (!password) {
      setError("Please enter a password.");
      return;
    }

    const passwordError = validatePassword();

    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!termsAccepted || !privacyAccepted) {
      setError(
        "You must accept both the Terms of Use and Privacy Notice before creating an account."
      );
      return;
    }

    setLoading(true);

    try {
      const consentTimestamp = new Date().toISOString();

      const { data, error: signupError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            terms_accepted: true,
            privacy_accepted: true,
            terms_accepted_at: consentTimestamp,
            privacy_accepted_at: consentTimestamp,
            policy_version: "1.0",
          },
        },
      });

      if (signupError) {
        throw signupError;
      }

      /*
       * If Supabase email confirmation is enabled,
       * the user will need to confirm their email.
       *
       * If email confirmation is disabled,
       * the user may be logged in immediately.
       */

      if (data.session) {
        navigate("/");
        return;
      }

      setMessage(
        "Account created successfully. Please check your email if email confirmation is required."
      );

      setEmail("");
      setPassword("");
      setConfirmPassword("");
      setTermsAccepted(false);
      setPrivacyAccepted(false);
    } catch (err: any) {
      console.error("Signup error:", err);

      setError(
        err?.message ||
          "Unable to create your account. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border bg-card p-6 shadow-lg sm:p-8">
          {/* Header */}
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold tracking-tight">
              Create an Account
            </h1>

            <p className="mt-2 text-sm text-muted-foreground">
              Create your GSI Schedule Planner account
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Success */}
          {message && (
            <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-400">
              {message}
            </div>
          )}

          <form onSubmit={handleSignup} className="space-y-5">
            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>

              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                disabled={loading}
                required
              />
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>

              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Create a password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  disabled={loading}
                  className="pr-10"
                  required
                />

                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={
                    showPassword
                      ? "Hide password"
                      : "Show password"
                  }
                  disabled={loading}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>

              <p className="text-xs text-muted-foreground">
                At least 8 characters, including uppercase, lowercase,
                and a number.
              </p>
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">
                Confirm Password
              </Label>

              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={
                    showConfirmPassword ? "text" : "password"
                  }
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={(e) =>
                    setConfirmPassword(e.target.value)
                  }
                  autoComplete="new-password"
                  disabled={loading}
                  className="pr-10"
                  required
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowConfirmPassword(!showConfirmPassword)
                  }
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={
                    showConfirmPassword
                      ? "Hide password"
                      : "Show password"
                  }
                  disabled={loading}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Terms */}
            <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
              {/* Terms of Use */}
              <div className="flex items-start gap-3">
                <Checkbox
                  id="terms"
                  checked={termsAccepted}
                  onCheckedChange={(checked) =>
                    setTermsAccepted(checked === true)
                  }
                  disabled={loading}
                />

                <div className="text-sm leading-5">
                  <label
                    htmlFor="terms"
                    className="cursor-pointer"
                  >
                    I agree to the{" "}
                  </label>

                  <Dialog>
                    <DialogTrigger asChild>
                      <button
                        type="button"
                        className="font-medium text-primary underline underline-offset-4"
                      >
                        Terms of Use
                      </button>
                    </DialogTrigger>

                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>
                          GSI Schedule Planner Terms of Use
                        </DialogTitle>
                      </DialogHeader>

                      <ScrollArea className="h-[60vh] pr-4">
                        <div className="space-y-5 text-sm leading-6">
                          <section>
                            <h3 className="font-semibold">
                              1. Acceptance of Terms
                            </h3>

                            <p>
                              By creating and using a GSI Schedule
                              Planner account, you agree to follow
                              these Terms of Use. If you do not agree
                              with these terms, please do not create
                              or use an account.
                            </p>
                          </section>

                          <section>
                            <h3 className="font-semibold">
                              2. Purpose of the System
                            </h3>

                            <p>
                              GSI Schedule Planner is a task and
                              schedule management system designed to
                              help users organize tasks, prioritize
                              activities, generate schedules, and
                              receive scheduling recommendations.
                            </p>
                          </section>

                          <section>
                            <h3 className="font-semibold">
                              3. User Responsibility
                            </h3>

                            <p>
                              Users are responsible for the accuracy
                              of the information they enter into the
                              system, including task descriptions,
                              deadlines, durations, priorities, and
                              other scheduling information.
                            </p>
                          </section>

                          <section>
                            <h3 className="font-semibold">
                              4. Scheduling Recommendations
                            </h3>

                            <p>
                              The system may automatically generate
                              task priorities, recommended schedules,
                              suggested time slots, and adaptive
                              scheduling recommendations. These
                              recommendations are intended to assist
                              users in organizing their work and
                              should be reviewed by the user.
                            </p>
                          </section>

                          <section>
                            <h3 className="font-semibold">
                              5. Account Security
                            </h3>

                            <p>
                              Users are responsible for maintaining
                              the confidentiality of their account
                              credentials and should not intentionally
                              share their password with other people.
                            </p>
                          </section>

                          <section>
                            <h3 className="font-semibold">
                              6. Prohibited Use
                            </h3>

                            <p>
                              Users must not intentionally misuse,
                              disrupt, damage, or attempt to gain
                              unauthorized access to the system or
                              another user's account.
                            </p>
                          </section>

                          <section>
                            <h3 className="font-semibold">
                              7. Changes to the Terms
                            </h3>

                            <p>
                              These Terms of Use may be updated when
                              necessary. Users may be informed when
                              significant changes are made.
                            </p>
                          </section>

                          <section>
                            <h3 className="font-semibold">
                              8. Contact
                            </h3>

                            <p>
                              For questions regarding these terms,
                              users may contact the administrators of
                              the GSI Schedule Planner system.
                            </p>
                          </section>
                        </div>
                      </ScrollArea>
                    </DialogContent>
                  </Dialog>
                  .
                </div>
              </div>

              {/* Privacy */}
              <div className="flex items-start gap-3">
                <Checkbox
                  id="privacy"
                  checked={privacyAccepted}
                  onCheckedChange={(checked) =>
                    setPrivacyAccepted(checked === true)
                  }
                  disabled={loading}
                />

                <div className="text-sm leading-5">
                  <label
                    htmlFor="privacy"
                    className="cursor-pointer"
                  >
                    I agree to the{" "}
                  </label>

                  <Dialog>
                    <DialogTrigger asChild>
                      <button
                        type="button"
                        className="font-medium text-primary underline underline-offset-4"
                      >
                        Privacy Notice
                      </button>
                    </DialogTrigger>

                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>
                          GSI Schedule Planner Privacy Notice
                        </DialogTitle>
                      </DialogHeader>

                      <ScrollArea className="h-[60vh] pr-4">
                        <div className="space-y-5 text-sm leading-6">
                          <section>
                            <h3 className="font-semibold">
                              1. Information We Collect
                            </h3>

                            <p>
                              The system may collect information
                              provided by users, such as their email
                              address, account information, task
                              information, schedules, task status,
                              and other information needed to operate
                              the scheduling features.
                            </p>
                          </section>

                          <section>
                            <h3 className="font-semibold">
                              2. How Information Is Used
                            </h3>

                            <p>
                              Information may be used to provide task
                              management, priority calculation,
                              scheduling, adaptive scheduling,
                              recommendations, progress tracking, and
                              other system functions.
                            </p>
                          </section>

                          <section>
                            <h3 className="font-semibold">
                              3. Behavioral Information
                            </h3>

                            <p>
                              Where applicable, the system may use
                              task completion and scheduling activity
                              to identify patterns that can support
                              scheduling recommendations and adaptive
                              features.
                            </p>
                          </section>

                          <section>
                            <h3 className="font-semibold">
                              4. Data Storage
                            </h3>

                            <p>
                              Account and application data may be
                              stored using the system's backend
                              services, including Supabase services.
                            </p>
                          </section>

                          <section>
                            <h3 className="font-semibold">
                              5. Data Sharing
                            </h3>

                            <p>
                              User information should only be
                              accessed or processed as necessary to
                              provide and maintain the system,
                              subject to applicable policies and
                              authorization.
                            </p>
                          </section>

                          <section>
                            <h3 className="font-semibold">
                              6. Data Security
                            </h3>

                            <p>
                              Reasonable technical and organizational
                              measures are used to help protect user
                              information from unauthorized access,
                              alteration, disclosure, or destruction.
                            </p>
                          </section>

                          <section>
                            <h3 className="font-semibold">
                              7. User Rights
                            </h3>

                            <p>
                              Users may have rights regarding their
                              personal information under applicable
                              privacy laws and regulations. Requests
                              regarding personal information may be
                              directed to the system administrators.
                            </p>
                          </section>

                          <section>
                            <h3 className="font-semibold">
                              8. Policy Updates
                            </h3>

                            <p>
                              This Privacy Notice may be updated when
                              necessary to reflect changes to the
                              system, data practices, or applicable
                              requirements.
                            </p>
                          </section>
                        </div>
                      </ScrollArea>
                    </DialogContent>
                  </Dialog>
                  .
                </div>
              </div>
            </div>

            {/* Create Account */}
            <Button
              type="submit"
              className="w-full"
              disabled={
                loading ||
                !termsAccepted ||
                !privacyAccepted
              }
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                "Create Account"
              )}
            </Button>
          </form>

          {/* Login */}
          <div className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              to="/login"
              className="font-medium text-primary underline underline-offset-4"
            >
              Log in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
