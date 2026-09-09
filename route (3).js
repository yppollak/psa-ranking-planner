import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
export async function GET(request){ const supabase = await createClient(); await supabase.auth.signOut(); return NextResponse.redirect(new URL("/", request.url)); }
