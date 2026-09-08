import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
// Keeps the Supabase session cookie fresh on every request.
export async function middleware(request){
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll(){ return request.cookies.getAll(); },
      setAll(list){ list.forEach(({ name, value }) => request.cookies.set(name, value)); response = NextResponse.next({ request }); list.forEach(({ name, value, options }) => response.cookies.set(name, value, options)); },
    },
  });
  await supabase.auth.getUser();
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
