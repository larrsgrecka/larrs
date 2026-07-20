import { createClient } from "@/utils/supabase/server";

export type Profile = {
  id: string;
  name: string | null;
  role: "admin" | "jefe_tienda" | "viewer" | "operador";
  tienda: string | null;
};

export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id, name, role, tienda")
    .eq("id", user.id)
    .single();

  return data as Profile | null;
}

export function isAdmin(profile: Profile | null) {
  return profile?.role === "admin";
}
