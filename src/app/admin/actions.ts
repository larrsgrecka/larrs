"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import { getProfile } from "@/utils/auth";
import { logAudit } from "@/utils/audit";

async function assertAdmin() {
  const profile = await getProfile();
  if (profile?.role !== "admin") throw new Error("Solo administradores");
  return profile;
}

export async function createUser(formData: FormData) {
  const actor = await assertAdmin();
  const admin = createAdminClient();
  const supabase = await createClient();

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const name = formData.get("name") as string;
  const role = formData.get("role") as string;
  const tienda = (formData.get("tienda") as string) || null;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error) throw new Error(error.message);

  await supabase
    .from("profiles")
    .update({ name, role, tienda })
    .eq("id", data.user.id);

  await logAudit({ actorId: actor.id, actorEmail: actor.name ?? undefined, action: "create_user", targetEmail: email });
  revalidatePath("/admin");
}

export async function updateUser(formData: FormData) {
  const actor = await assertAdmin();
  const supabase = await createClient();
  const admin = createAdminClient();

  const id = formData.get("id") as string;
  const name = formData.get("name") as string;
  const role = formData.get("role") as string;
  const tienda = (formData.get("tienda") as string) || null;
  const password = formData.get("password") as string;

  const { data: target } = await admin.auth.admin.getUserById(id);
  await supabase.from("profiles").update({ name, role, tienda }).eq("id", id);

  if (password) {
    await admin.auth.admin.updateUserById(id, { password });
  }

  await logAudit({ actorId: actor.id, actorEmail: actor.name ?? undefined, action: "update_user", targetEmail: target.user?.email });
  revalidatePath("/admin");
}

export async function deleteUser(formData: FormData) {
  const actor = await assertAdmin();
  const admin = createAdminClient();
  const id = formData.get("id") as string;

  const { data: target } = await admin.auth.admin.getUserById(id);
  await admin.auth.admin.deleteUser(id);

  await logAudit({ actorId: actor.id, actorEmail: actor.name ?? undefined, action: "delete_user", targetEmail: target.user?.email });
  revalidatePath("/admin");
}
