"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { logAudit } from "@/utils/audit";

export async function changePassword(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const current = formData.get("current") as string;
  const newPass = formData.get("new") as string;
  const confirm = formData.get("confirm") as string;

  if (newPass !== confirm) {
    redirect("/cuenta?error=Las+contraseñas+no+coinciden");
  }
  if (newPass.length < 6) {
    redirect("/cuenta?error=La+contraseña+debe+tener+al+menos+6+caracteres");
  }

  // Verificar contraseña actual
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: user.email!,
    password: current,
  });
  if (authError) {
    redirect("/cuenta?error=La+contraseña+actual+es+incorrecta");
  }

  const { error } = await supabase.auth.updateUser({ password: newPass });
  if (error) {
    redirect("/cuenta?error=" + encodeURIComponent(error.message));
  }

  await logAudit({ actorId: user.id, actorEmail: user.email, action: "update_user", targetEmail: user.email });
  redirect("/cuenta?ok=1");
}
