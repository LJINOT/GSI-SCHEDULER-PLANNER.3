import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Loader2, Camera, Trash2 } from "lucide-react";
import { sanitizePhone } from "@/lib/validation";

type ProfileKind = "student" | "professional" | "general";

export default function ProfilePage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthday, setBirthday] = useState("");
  const [profileKind, setProfileKind] = useState<ProfileKind>("general");
  const [course, setCourse] = useState("");
  const [yearLevel, setYearLevel] = useState("");
  const [school, setSchool] = useState("");
  const [occupation, setOccupation] = useState("");
  const [organization, setOrganization] = useState("");
  const [bio, setBio] = useState("");
  const [loading, setLoading] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setEmail(user.email || "");
        const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
        if (profile) {
          setFullName(profile.full_name || "");
          setPhone((profile as any).phone || "");
          setBirthday((profile as any).birthday || "");
          setCourse((profile as any).course || "");
          setYearLevel((profile as any).year_level || "");
          setSchool((profile as any).school || "");
          setOccupation((profile as any).occupation || "");
          setOrganization((profile as any).organization || "");
          setBio((profile as any).bio || "");
          setProfileKind(((profile as any).profile_kind as ProfileKind) || "general");
          const path = (profile as any).avatar_url as string | null;
          if (path) {
            setAvatarPath(path);
            const { data: signed } = await supabase.storage.from("avatars").createSignedUrl(path, 60 * 60 * 24 * 7);
            if (signed?.signedUrl) setAvatarUrl(signed.signedUrl);
          }
        }
      }
    };
    load();
  }, []);

  const uploadAvatar = async (file: File) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5MB"); return; }
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const ext = file.name.split(".").pop() || "png";
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      // Remove old file
      if (avatarPath && avatarPath !== path) {
        await supabase.storage.from("avatars").remove([avatarPath]);
      }
      const { error: dbErr } = await supabase.from("profiles").upsert({ id: user.id, avatar_url: path } as any);
      if (dbErr) throw dbErr;
      const { data: signed } = await supabase.storage.from("avatars").createSignedUrl(path, 60 * 60 * 24 * 7);
      setAvatarPath(path);
      setAvatarUrl(signed?.signedUrl || null);
      window.dispatchEvent(new CustomEvent("avatar-updated", { detail: { url: signed?.signedUrl || null } }));
      toast.success("Profile picture updated!");
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    }
    setUploading(false);
  };

  const removeAvatar = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    if (avatarPath) await supabase.storage.from("avatars").remove([avatarPath]);
    await supabase.from("profiles").upsert({ id: user.id, avatar_url: null } as any);
    setAvatarPath(null);
    setAvatarUrl(null);
    window.dispatchEvent(new CustomEvent("avatar-updated", { detail: { url: null } }));
    toast.success("Profile picture removed");
  };

  const saveProfile = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      full_name: fullName,
      phone,
      course: course || null,
      year_level: yearLevel || null,
      school: school || null,
      occupation: occupation || null,
      organization: organization || null,
      profile_kind: profileKind,
      bio: bio || null,
    } as any);
    if (error) toast.error(error.message);
    else toast.success("Profile updated!");
    setLoading(false);
  };

  const changePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) toast.error(error.message);
    else { toast.success("Password updated!"); setNewPassword(""); }
    setLoading(false);
  };

  const initials = fullName ? fullName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) : "U";

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto space-y-6">
      <h1 className="font-display text-3xl font-bold">Profile</h1>

      <Card>
        <CardHeader><CardTitle className="font-display text-lg">Personal Information</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-20 w-20 ring-2 ring-primary/20">
              {avatarUrl && <img src={avatarUrl} alt="Profile picture" className="h-full w-full object-cover" />}
              <AvatarFallback className="bg-primary/10 text-primary text-xl">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <p className="font-medium">{fullName || "User"}</p>
              <p className="text-sm text-muted-foreground mb-2">{email}</p>
              <div className="flex gap-2 flex-wrap">
                <label htmlFor="avatar-input">
                  <input
                    id="avatar-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.target.value = ""; }}
                  />
                  <Button asChild size="sm" variant="outline" disabled={uploading}>
                    <span className="cursor-pointer">
                      {uploading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Camera className="mr-2 h-3.5 w-3.5" />}
                      {avatarUrl ? "Change" : "Upload"}
                    </span>
                  </Button>
                </label>
                {avatarUrl && (
                  <Button size="sm" variant="ghost" onClick={removeAvatar} disabled={uploading}>
                    <Trash2 className="mr-2 h-3.5 w-3.5" /> Remove
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" autoCorrect="on" spellCheck />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(sanitizePhone(e.target.value))}
                placeholder="09171234567"
                maxLength={15}
              />
              <p className="text-xs text-muted-foreground">Numbers only.</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={email} disabled className="bg-muted" />
          </div>

          <div className="space-y-2">
            <Label>I am a…</Label>
            <Select value={profileKind} onValueChange={(v) => setProfileKind(v as ProfileKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="student">Student</SelectItem>
                <SelectItem value="professional">Working Professional</SelectItem>
                <SelectItem value="general">General / Other</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Tailors the optional fields below — leave any blank if not applicable.</p>
          </div>

          {profileKind === "student" && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="school">School / University</Label>
                  <Input id="school" value={school} onChange={(e) => setSchool(e.target.value)} placeholder="e.g. State University" autoCorrect="on" spellCheck />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="course">Course / Program</Label>
                  <Input id="course" value={course} onChange={(e) => setCourse(e.target.value)} placeholder="e.g. BS Computer Science" autoCorrect="on" spellCheck />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="year">Year Level</Label>
                <Input id="year" value={yearLevel} onChange={(e) => setYearLevel(e.target.value)} placeholder="e.g. 3rd Year" />
              </div>
            </>
          )}

          {profileKind === "professional" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="occupation">Occupation / Role</Label>
                <Input id="occupation" value={occupation} onChange={(e) => setOccupation(e.target.value)} placeholder="e.g. Project Manager" autoCorrect="on" spellCheck />
              </div>
              <div className="space-y-2">
                <Label htmlFor="org">Organization / Company</Label>
                <Input id="org" value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder="e.g. Acme Corp" autoCorrect="on" spellCheck />
              </div>
            </div>
          )}

          {profileKind === "general" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="occupation-g">What you do (optional)</Label>
                <Input id="occupation-g" value={occupation} onChange={(e) => setOccupation(e.target.value)} placeholder="e.g. Freelancer, Parent, Student" autoCorrect="on" spellCheck />
              </div>
              <div className="space-y-2">
                <Label htmlFor="org-g">Affiliation (optional)</Label>
                <Input id="org-g" value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder="e.g. Personal, Independent" autoCorrect="on" spellCheck />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell us about yourself..." rows={3} autoCorrect="on" spellCheck />
          </div>

          <Button onClick={saveProfile} disabled={loading} className="w-full">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Profile
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-display text-lg">Change Password</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-pass">New Password</Label>
            <Input id="new-pass" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min 6 characters" />
          </div>
          <Button variant="outline" onClick={changePassword} disabled={loading} className="w-full">
            Update Password
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}
