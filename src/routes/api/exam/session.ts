import { createFileRoute } from "@tanstack/react-router";
import { jsonErr } from "@/lib/json-api";
import { verifyUserRequest } from "@/lib/user-auth.server";
import { loadActiveExamForUser } from "@/lib/school-exam.server";

export const Route = createFileRoute("/api/exam/session")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = await verifyUserRequest(request);
        if (!u) return jsonErr("unauthorized", 401);
        const exam = await loadActiveExamForUser(u.userId);
        return Response.json({ exam });
      },
    },
  },
});
