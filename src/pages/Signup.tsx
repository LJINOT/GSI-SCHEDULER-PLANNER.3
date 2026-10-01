```tsx
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
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { PasswordField } from "@/components/PasswordField";
import { validatePassword } from "@/lib/validation";
import { ShieldCheck, FileText } from "lucide-react";

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);

  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

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

    if (!acceptedTerms) {
      toast.error(
        "Please accept the Terms of Use before creating your account."
      );
      return;
    }

    if (!acceptedPrivacy) {
      toast.error(
        "Please accept the Privacy Notice before creating your account."
      );
      return;
    }

    setLoading(true);

    const consentTimestamp = new Date().toISOString();

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          full_name: fullName.trim(),

          /*
           * Record the user's acceptance in Supabase Auth metadata.
           * This allows the system to know that the user accepted
           * the Terms of Use and Privacy Notice during registration.
           */
          terms_accepted: true,
          privacy_accepted: true,
          terms_accepted_at: consentTimestamp,
          privacy_accepted_at: consentTimestamp,
          policy_version: "1.0",
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
     * Supabase returns a user without an active session.
     */
    if (data.user && !data.session) {
      setRegistered(true);

      toast.success(
        "Account created. Please check your email for confirmation."
      );

      return;
    }

    /*
     * When email confirmation is disabled,
     * Supabase creates the session immediately.
     */
    if (data.session) {
      toast.success("Account created successfully.");

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
              Open your email and click the confirmation link before
              signing in to GSI Schedule Planner.
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
    <>
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
                <Label htmlFor="name">
                  Full Name
                </Label>

                <Input
                  id="name"
                  value={fullName}
                  onChange={(e) =>
                    setFullName(e.target.value)
                  }
                  placeholder="John Doe"
                  required
                />
              </div>

              {/* Email */}
              <div className="space-y-2">
                <Label htmlFor="email">
                  Email
                </Label>

                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) =>
                    setEmail(e.target.value)
                  }
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

              {/* =================================================
                  TERMS AND PRIVACY
                  ================================================= */}

              <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
                <div className="flex items-start gap-3">
                  <FileText className="h-5 w-5 mt-0.5 text-primary shrink-0" />

                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      Before creating your account
                    </p>

                    <p className="text-xs text-muted-foreground">
                      Please review and accept the Terms of Use
                      and Privacy Notice.
                    </p>
                  </div>
                </div>

                {/* Terms */}
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="terms"
                    checked={acceptedTerms}
                    onCheckedChange={(checked) =>
                      setAcceptedTerms(
                        checked === true
                      )
                    }
                    className="mt-0.5"
                  />

                  <label
                    htmlFor="terms"
                    className="text-sm leading-5 cursor-pointer"
                  >
                    I have read and agree to the{" "}
                    <button
                      type="button"
                      onClick={() =>
                        setShowTerms(true)
                      }
                      className="text-primary underline underline-offset-2 hover:text-primary/80 font-medium"
                    >
                      Terms of Use
                    </button>
                    .
                  </label>
                </div>

                {/* Privacy */}
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="privacy"
                    checked={acceptedPrivacy}
                    onCheckedChange={(checked) =>
                      setAcceptedPrivacy(
                        checked === true
                      )
                    }
                    className="mt-0.5"
                  />

                  <label
                    htmlFor="privacy"
                    className="text-sm leading-5 cursor-pointer"
                  >
                    I have read and agree to the{" "}
                    <button
                      type="button"
                      onClick={() =>
                        setShowPrivacy(true)
                      }
                      className="text-primary underline underline-offset-2 hover:text-primary/80 font-medium"
                    >
                      Privacy Notice
                    </button>
                    .
                  </label>
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-3">
              <Button
                type="submit"
                className="w-full"
                disabled={
                  loading ||
                  !!validatePassword(password) ||
                  !acceptedTerms ||
                  !acceptedPrivacy
                }
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

      {/* =====================================================
          TERMS OF USE DIALOG
          ===================================================== */}

      <Dialog
        open={showTerms}
        onOpenChange={setShowTerms}
      >
        <DialogContent className="max-w-2xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              GSI Schedule Planner Terms of Use
            </DialogTitle>

            <DialogDescription>
              Please review these terms before creating your account.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="h-[60vh] pr-4">
            <div className="space-y-6 text-sm leading-6">
              <div>
                <h3 className="font-semibold text-base mb-2">
                  1. Purpose of the System
                </h3>

                <p className="text-muted-foreground">
                  GSI Schedule Planner is a task and schedule
                  management system designed to assist users in
                  organizing tasks, prioritizing work, generating
                  schedules, and receiving scheduling recommendations.
                  The System is intended to provide decision-support
                  and productivity assistance.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-base mb-2">
                  2. Account Registration
                </h3>

                <p className="text-muted-foreground">
                  Users may be required to provide an email address
                  and other information necessary to create and
                  maintain an account. Users are responsible for
                  providing accurate information and maintaining the
                  security of their account credentials.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-base mb-2">
                  3. Acceptable Use
                </h3>

                <p className="text-muted-foreground">
                  Users agree to use the System only for lawful and
                  appropriate purposes. Users should not attempt to
                  gain unauthorized access to another user's account
                  or information, interfere with the operation or
                  security of the System, or access, modify, or delete
                  information belonging to another user.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-base mb-2">
                  4. Scheduling and Recommendations
                </h3>

                <p className="text-muted-foreground">
                  Schedules, priorities, recommendations, and
                  adaptive adjustments generated by the System are
                  intended to assist users with task organization
                  and time management. Generated schedules are not a
                  guarantee that a task will be completed by a
                  particular time. Users remain responsible for
                  reviewing schedules and deciding whether a
                  recommendation is appropriate for their
                  circumstances.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-base mb-2">
                  5. Automated Processing
                </h3>

                <p className="text-muted-foreground">
                  Some System features automatically process task
                  information and behavioral information to calculate
                  priorities, generate schedules, identify patterns,
                  and provide recommendations. Scheduling
                  recommendations may change when relevant task
                  information or user activity changes.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-base mb-2">
                  6. User-Provided Information
                </h3>

                <p className="text-muted-foreground">
                  Users are responsible for the information they
                  enter into the System. Users should avoid entering
                  unnecessary sensitive or confidential information
                  into task descriptions or other fields unless the
                  System specifically requires such information.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-base mb-2">
                  7. Privacy
                </h3>

                <p className="text-muted-foreground">
                  The collection and processing of personal information
                  are governed by the GSI Schedule Planner Privacy
                  Notice. By using the System, users acknowledge that
                  their information may be processed for the purposes
                  described in that Privacy Notice.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-base mb-2">
                  8. System Availability
                </h3>

                <p className="text-muted-foreground">
                  The System may occasionally be unavailable because
                  of maintenance, technical problems, service-provider
                  interruptions, or other circumstances beyond the
                  control of the System administrators.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-base mb-2">
                  9. Account Termination
                </h3>

                <p className="text-muted-foreground">
                  An account may be suspended or terminated when
                  necessary because of security concerns, misuse of
                  the System, violation of these Terms, or other
                  legitimate reasons.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-base mb-2">
                  10. Changes to These Terms
                </h3>

                <p className="text-muted-foreground">
                  These Terms may be updated when necessary because
                  of changes to the System, its features, applicable
                  requirements, or operational practices. Material
                  changes should be communicated through an
                  appropriate notice.
                </p>
              </div>

              <div className="rounded-lg border bg-muted/50 p-4">
                <p className="text-xs text-muted-foreground">
                  <strong>Effective Date:</strong>{" "}
                  [Insert Date]
                  <br />
                  <strong>Policy Version:</strong> 1.0
                  <br />
                  <strong>System Administrator:</strong>{" "}
                  [Insert Name/Office]
                  <br />
                  <strong>Email:</strong>{" "}
                  [Insert Official Email]
                </p>
              </div>
            </div>
          </ScrollArea>

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => {
                setAcceptedTerms(true);
                setShowTerms(false);
              }}
            >
              I Understand
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* =====================================================
          PRIVACY NOTICE DIALOG
          ===================================================== */}

      <Dialog
        open={showPrivacy}
        onOpenChange={setShowPrivacy}
      >
        <DialogContent className="max-w-2xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              GSI Schedule Planner Privacy Notice
            </DialogTitle>

            <DialogDescription>
              Please review how your information is collected and
              processed.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="h-[60vh] pr-4">
            <div className="space-y-6 text-sm leading-6">
              <div>
                <h3 className="font-semibold text-base mb-2">
                  1. Information We Collect
                </h3>

                <p className="text-muted-foreground">
                  The System may collect and process account
                  information such as your email address and name,
                  as well as task titles and descriptions, categories,
                  priorities, deadlines, estimated durations, task
                  status, schedules, task completion information,
                  start and completion times, scheduling preferences,
                  and behavioral information generated through your
                  interaction with the System.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-base mb-2">
                  2. Purpose of Data Processing
                </h3>

                <p className="text-muted-foreground">
                  Information may be used to create and maintain your
                  account, authenticate you, manage tasks, generate
                  schedules, calculate priorities, provide scheduling
                  recommendations, identify patterns in task
                  completion and working times, provide adaptive
                  scheduling, improve system functionality, and
                  maintain system security.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-base mb-2">
                  3. Behavioral Data and Personalization
                </h3>

                <p className="text-muted-foreground">
                  GSI Schedule Planner may analyze information
                  generated from activities within the System, such
                  as task completion times, task durations, and
                  scheduling activity. This information may be used
                  to identify recurring patterns that can help
                  scheduling features provide more relevant
                  recommendations.
                </p>

                <p className="text-muted-foreground mt-2">
                  The System does not require a fixed number of days
                  before behavioral analysis can begin. The reliability
                  of identified patterns may improve as more activity
                  is recorded.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-base mb-2">
                  4. Data Storage
                </h3>

                <p className="text-muted-foreground">
                  Account, task, scheduling, and related behavioral
                  information may be stored using the System's
                  database and hosting infrastructure, including
                  Supabase services configured by the System
                  administrators.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-base mb-2">
                  5. Data Retention
                </h3>

                <p className="text-muted-foreground">
                  Personal information and system-generated records
                  will be retained only for as long as reasonably
                  necessary for the purposes for which they were
                  collected, to maintain the user's account and
                  system functionality, or as otherwise required or
                  permitted by applicable law.
                </p>

                <p className="text-muted-foreground mt-2">
                  Records may include account information, tasks,
                  schedules, task-completion information, and
                  behavioral records. Where information is no longer
                  necessary for its stated purpose, the System may
                  delete, anonymize, or otherwise dispose of the
                  information in accordance with applicable
                  requirements and the System's data-retention
                  procedures.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-base mb-2">
                  6. Data Sharing
                </h3>

                <p className="text-muted-foreground">
                  The System will not intentionally sell users'
                  personal information. Information may be processed
                  by service providers that support the operation of
                  the System, such as database, authentication,
                  hosting, or infrastructure providers, where
                  necessary to provide the System's services.
                  Information may also be disclosed when required or
                  permitted by applicable law.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-base mb-2">
                  7. Data Security
                </h3>

                <p className="text-muted-foreground">
                  Reasonable technical and organizational measures
                  will be used to protect personal information against
                  unauthorized access, alteration, disclosure, or
                  destruction. Users are responsible for maintaining
                  the confidentiality of their account credentials.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-base mb-2">
                  8. User Rights
                </h3>

                <p className="text-muted-foreground">
                  Subject to applicable law and appropriate
                  verification, users may have rights concerning
                  their personal information, including the right to
                  be informed, access personal information, request
                  correction of inaccurate information, object to
                  certain processing, request erasure or blocking
                  where applicable, request data portability where
                  applicable, withdraw consent where processing is
                  based on consent, and lodge a complaint with the
                  appropriate privacy authority.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-base mb-2">
                  9. Changes to This Privacy Notice
                </h3>

                <p className="text-muted-foreground">
                  This Privacy Notice may be updated when necessary
                  to reflect changes in the System, data-processing
                  practices, or applicable requirements. Users will
                  be provided appropriate notice of material changes.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-base mb-2">
                  10. Contact
                </h3>

                <p className="text-muted-foreground">
                  For questions, concerns, or requests relating to
                  privacy and personal information, users may contact
                  the System Administrator using the official contact
                  information provided by the institution.
                </p>
              </div>

              <div className="rounded-lg border bg-muted/50 p-4">
                <p className="text-xs text-muted-foreground">
                  <strong>Effective Date:</strong>{" "}
                  [Insert Date]
                  <br />
                  <strong>Policy Version:</strong> 1.0
                  <br />
                  <strong>System Administrator:</strong>{" "}
                  [Insert Name/Office]
                  <br />
                  <strong>Email:</strong>{" "}
                  [Insert Official Email]
                </p>
              </div>
            </div>
          </ScrollArea>

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => {
                setAcceptedPrivacy(true);
                setShowPrivacy(false);
              }}
            >
              I Understand
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
```
