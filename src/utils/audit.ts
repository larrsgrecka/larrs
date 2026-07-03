import { createAdminClient } from "@/utils/supabase/admin";

type AuditAction = "login" | "logout" | "create_user" | "update_user" | "delete_user";

export async function logAudit({
  actorId,
  actorEmail,
  action,
  targetEmail,
}: {
  actorId?: string | null;
  actorEmail?: string | null;
  action: AuditAction;
  targetEmail?: string | null;
}) {
  try {
    const admin = createAdminClient();
    await admin.from("audit_log").insert({
      actor_id: actorId ?? null,
      actor_email: actorEmail ?? null,
      action,
      target_email: targetEmail ?? null,
    });
  } catch {
    // Log silencioso — no interrumpir el flujo principal
  }
}
