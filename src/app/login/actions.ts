"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { logAudit } from "@/utils/audit";

export async function login(formData: FormData) {
  const supabase = await createClient();
  const email = formData.get("email") as string;
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: formData.get("password") as string,
  });
  if (error) redirect("/login?error=Correo+o+contraseña+incorrectos");
  await logAudit({ actorId: data.user.id, actorEmail: email, action: "login" });
  revalidatePath("/", "layout");
  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  await logAudit({ actorId: user?.id, actorEmail: user?.email, action: "logout" });
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
