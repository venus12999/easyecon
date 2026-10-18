import { activeAccessToken } from "@/lib/exam-auth";

export async function authFetch(input: string, init: RequestInit = {}) {
  const token = await activeAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(input, { ...init, headers });
}
