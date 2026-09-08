import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
// Google sends the user back here; we exchange the code for a session cookie and go home.
export async function GET(request){
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if(code){ const supabase = await createClient(); const { error } = await supabase.auth.exchangeCodeForSession(code); if(!error) return NextResponse.redirect(origin + "/"); }
  return NextResponse.redirect(origin + "/?error=signin");
}
