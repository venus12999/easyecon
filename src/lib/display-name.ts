import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

type NamedUser = {
  id?: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
} | null | undefined;

/** Name captured at signup. It lives in auth metadata even before the profile row is filled. */
export function registeredDisplayName(user: NamedUser): string {
  const raw = user?.user_metadata?.display_name;
  return typeof raw === "string" ? raw.trim() : "";
}

function emailPrefix(email?: string | null): string {
  if (!email || email.endsWith("@exam.easyecon.local")) return "";
  const prefix = email.split("@")[0]?.trim();
  return prefix || "";
}

/** Profile name, then the name from registration, then the mailbox prefix. */
export function useAccountLabel(fallback = ""): string {
  const { user } = useAuth();
  const [profileName, setProfileName] = useState("");

  useEffect(() => {
    if (!user) {
      setProfileName("");
      return;
    }
    let cancel = false;
    void supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancel) return;
        setProfileName(typeof data?.display_name === "string" ? data.display_name.trim() : "");
      });
    return () => {
      cancel = true;
    };
  }, [user]);

  return profileName || registeredDisplayName(user) || emailPrefix(user?.email) || fallback;
}
