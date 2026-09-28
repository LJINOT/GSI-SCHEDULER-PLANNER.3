import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Mail, Phone, GraduationCap, BriefcaseBusiness, Building2, UserRound, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type ProfileKind = "student" | "professional" | "general";

type ProfileData = {
  full_name: string | null;
  phone: string | null;
  course: string | null;
  year_level: string | null;
  school: string | null;
  occupation: string | null;
  organization: string | null;
  profile_kind: ProfileKind | null;
  bio: string | null;
  avatar_url: string | null;
};

const kindLabels: Record<ProfileKind, string> = {
  student: "Student",
  professional: "Working Professional",
  general: "General / Other",
};

export default function ProfileView() {
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (active) setLoading(false);
        return;
      }

      if (active) setEmail(user.email || "");

      const { data } = await supabase
        .from("profiles")
        .select(
          "full_name, phone, course, year_level, school, occupation, organization, profile_kind, bio, avatar_url",
        )
        .eq("id", user.id)
        .single();

      if (!active) return;

      const nextProfile = (data as ProfileData | null) ?? {
        full_name: null,
        phone: null,
        course: null,
        year_level: null,
        school: null,
        occupation: null,
        organization: null,
        profile_kind: "general",
        bio: null,
        avatar_url: null,
      };

      setProfile(nextProfile);

      if (nextProfile.avatar_url) {
        const { data: signed } = await supabase.storage
          .from("avatars")
          .createSignedUrl(nextProfile.avatar_url, 60 * 60 * 24 * 7);
        if (active) setAvatarUrl(signed?.signedUrl || null);
      } else {
        setAvatarUrl(null);
      }

      setLoading(false);
    };

    void load();

    const handler = () => void load();
    window.addEventListener("avatar-updated", handler);
    return () => {
      active = false;
      window.removeEventListener("avatar-updated", handler);
    };
  }, []);

  const fullName = profile?.full_name?.trim() || "User";
  const initials = fullName
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "U";
  const kind = profile?.profile_kind || "general";

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <Skeleton className="h-20 w-20 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-56" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-3xl mx-auto space-y-6"
    >
      <div>
        <h1 className="font-display text-3xl font-bold">My Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View your account and personal information.
        </p>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            <Avatar className="h-24 w-24 shrink-0 ring-2 ring-primary/15">
              {avatarUrl && (
                <img
                  src={avatarUrl}
                  alt="Profile picture"
                  className="h-full w-full object-cover"
                />
              )}
              <AvatarFallback className="bg-primary/10 text-primary text-2xl font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-2xl font-bold truncate">{fullName}</h2>
                <Badge variant="secondary">{kindLabels[kind]}</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5 break-all">
                <Mail className="h-4 w-4 shrink-0" />
                {email || "No email available"}
              </p>
              <p className="text-xs text-muted-foreground mt-3">
                Read-only profile view. Manage your information in Settings → Profile.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <UserRound className="h-5 w-5 text-primary" />
            Personal Information
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <InfoRow icon={Mail} label="Email" value={email} />
          <InfoRow icon={Phone} label="Phone" value={profile?.phone} />
          <InfoRow icon={UserRound} label="Profile Type" value={kindLabels[kind]} />
          {kind === "student" && (
            <>
              <InfoRow icon={GraduationCap} label="School / University" value={profile?.school} />
              <InfoRow icon={GraduationCap} label="Course / Program" value={profile?.course} />
              <InfoRow icon={GraduationCap} label="Year Level" value={profile?.year_level} />
            </>
          )}
          {kind === "professional" && (
            <>
              <InfoRow icon={BriefcaseBusiness} label="Occupation / Role" value={profile?.occupation} />
              <InfoRow icon={Building2} label="Organization / Company" value={profile?.organization} />
            </>
          )}
          {kind === "general" && (
            <>
              <InfoRow icon={BriefcaseBusiness} label="What you do" value={profile?.occupation} />
              <InfoRow icon={Building2} label="Affiliation" value={profile?.organization} />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <Info className="h-5 w-5 text-primary" />
            About
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 whitespace-pre-wrap break-words">
            {profile?.bio?.trim() || "No bio has been added."}
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value?: string | null;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p className="mt-1 text-sm font-medium break-words">
        {value?.trim() || "Not provided"}
      </p>
    </div>
  );
}
