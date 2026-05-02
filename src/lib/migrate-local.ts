import { supabase } from "@/integrations/supabase/client";
import { getWrong } from "@/lib/storage";

const DONE_KEY = "ap-econ-migrated-v1";

export async function migrateLocalToCloud(userId: string) {
  if (typeof window === "undefined") return;
  const flag = `${DONE_KEY}:${userId}`;
  if (localStorage.getItem(flag)) return;

  // 错题迁移
  const wrongIds = getWrong();
  if (wrongIds.length > 0) {
    const rows = wrongIds.map((qid) => ({ user_id: userId, question_id: qid }));
    await supabase.from("wrong_questions").upsert(rows, { onConflict: "user_id,question_id" });
  }

  localStorage.setItem(flag, String(Date.now()));
}