import { createClient } from "../lib/supabase/server";
import SignIn from "../components/SignIn";
import Planner from "../components/Planner";
export const dynamic = "force-dynamic";
export default async function Home(){
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if(!user) return <SignIn />;
  const { data: profile } = await supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  return <Planner user={{ id: user.id, email: user.email }} isAdmin={!!(profile && profile.is_admin)} />;
}
