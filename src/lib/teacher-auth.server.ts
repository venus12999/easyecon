import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isAdminEmailServer } from "@/lib/admin-emails.server";
import { verifyUserRequest } from "@/lib/user-auth.server";

export async function verifyTeacherRequest(request: Request) {
  const u = await verifyUserRequest(request);
  if (!u) return null;
  if (isAdminEmailServer(u.email)) return u;
  const { data, error } = await supabaseAdmin.rpc("is_school_staff", { _user_id: u.userId });
  if (error || data !== true) return null;
  return u;
}

export async function ensureTeacherClass(teacherUserId: string) {
  const { data: existing } = await supabaseAdmin
    .from("school_classes")
    .select("id,name,teacher_user_id,created_at")
    .eq("teacher_user_id", teacherUserId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await supabaseAdmin
    .from("school_classes")
    .insert({ teacher_user_id: teacherUserId, name: "默认班级" })
    .select("id,name,teacher_user_id,created_at")
    .single();
  if (error || !data) throw error ?? new Error("无法创建班级");
  return data;
}

export async function assertClassOwner(classId: string, teacherUserId: string, email: string | null) {
  const { data } = await supabaseAdmin
    .from("school_classes")
    .select("id,teacher_user_id")
    .eq("id", classId)
    .maybeSingle();
  if (!data) return false;
  if (data.teacher_user_id === teacherUserId) return true;
  return isAdminEmailServer(email);
}
