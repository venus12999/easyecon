import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isAdminEmailServer } from "@/lib/admin-emails.server";
import { createUserScopedClient, verifyUserRequest } from "@/lib/user-auth.server";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getTeacherDb(jwt: string): Promise<SupabaseClient> {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return supabaseAdmin as unknown as SupabaseClient;
  // Do not call auth.setSession with a fake refresh token: a failed refresh
  // drops the client to the anon key, and storage uploads then hit RLS.
  return createUserScopedClient(jwt) as unknown as SupabaseClient;
}

export async function uploadTeacherAssignmentImage(jwt: string, path: string, file: File) {
  const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return { error: { message: "Missing Supabase URL or anon key" }, publicUrl: "" };
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { error } = await supabaseAdmin.storage.from("question-images").upload(path, file, {
      contentType: file.type || "image/png",
      upsert: true,
    });
    if (!error) return { error: null, publicUrl: `${url}/storage/v1/object/public/question-images/${path}` };
  }
  const objectUrl = `${url}/storage/v1/object/question-images/${path}`;
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", file);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${jwt}`,
    apikey: anon,
    "x-upsert": "true",
  };
  let res = await fetch(objectUrl, { method: "POST", headers, body: form });
  if (!res.ok) {
    res = await fetch(objectUrl, { method: "PUT", headers, body: form });
  }
  if (!res.ok) {
    const text = await res.text();
    let message = text.slice(0, 400);
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      message = parsed.message || parsed.error || message;
    } catch {
      /* keep raw body */
    }
    return { error: { message }, publicUrl: "" };
  }
  return { error: null, publicUrl: `${url}/storage/v1/object/public/question-images/${path}` };
}

export async function verifyTeacherRequest(request: Request) {
  const u = await verifyUserRequest(request);
  if (!u) return null;
  if (isAdminEmailServer(u.email)) return u;
  const db = await getTeacherDb(u.jwt);
  const { data, error } = await db.rpc("is_school_staff", { _user_id: u.userId });
  if (error || data !== true) return null;
  return u;
}

export async function ensureTeacherClass(teacherUserId: string, db: SupabaseClient) {
  const { data: existing } = await db
    .from("school_classes")
    .select("id,name,teacher_user_id,created_at")
    .eq("teacher_user_id", teacherUserId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await db
    .from("school_classes")
    .insert({ teacher_user_id: teacherUserId, name: "默认班级" })
    .select("id,name,teacher_user_id,created_at")
    .single();
  if (error || !data) throw error ?? new Error("无法创建班级");
  return data;
}

export async function assertClassOwner(classId: string, teacherUserId: string, email: string | null, db: SupabaseClient) {
  const { data } = await db
    .from("school_classes")
    .select("id,teacher_user_id")
    .eq("id", classId)
    .maybeSingle();
  if (!data) return false;
  if (data.teacher_user_id === teacherUserId) return true;
  return isAdminEmailServer(email);
}
