import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Save, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "个人资料 · AP Micro" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    void supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setName(data?.display_name ?? "");
        setLoading(false);
      });
  }, [authLoading, user]);

  async function saveProfile() {
    if (!user) return;
    const displayName = name.trim();
    if (displayName.length < 1 || displayName.length > 40) {
      toast.error("昵称需为 1–40 个字符");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName })
      .eq("user_id", user.id);
    setSaving(false);
    if (error) {
      toast.error("保存失败，请稍后重试");
      return;
    }
    setName(displayName);
    toast.success("昵称已保存");
  }

  if (authLoading || loading) {
    return <Loader2 className="mx-auto mt-16 h-5 w-5 animate-spin text-muted-foreground" />;
  }

  if (!user) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center space-y-4">
        <h1 className="text-2xl font-bold">个人资料</h1>
        <p className="text-sm text-muted-foreground">登录后即可设置你的昵称。</p>
        <Button asChild><Link to="/auth">登录 / 注册</Link></Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
          <UserRound className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">个人资料</h1>
          <p className="text-sm text-muted-foreground">设置你在平台中显示的名字</p>
        </div>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">基本信息</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="display-name">昵称</Label>
            <Input
              id="display-name"
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 40))}
              placeholder="给自己取个名字"
              maxLength={40}
            />
            <p className="text-xs text-muted-foreground">昵称会显示在首页和管理后台。</p>
          </div>
          <div className="space-y-2">
            <Label>登录邮箱</Label>
            <Input value={user.email ?? ""} disabled />
          </div>
          <Button onClick={() => void saveProfile()} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存资料
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}