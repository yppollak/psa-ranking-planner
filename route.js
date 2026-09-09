import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Where the browser extension delivers entry lists. Authenticated with a
// personal ingest token, not a session, so it works from an extension.
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-ingest-token",
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS(){
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request){
  const token = (request.headers.get("x-ingest-token") || "").trim();
  if(token.length < 32){
    return NextResponse.json({ error: "Missing ingest token. Copy it from the planner's Settings tab." }, { status: 401, headers: CORS });
  }

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400, headers: CORS }); }

  const items = Array.isArray(body && body.items) ? body.items : null;
  if(!items){
    return NextResponse.json({ error: 'Expected {"items": [...]}.' }, { status: 400, headers: CORS });
  }
  if(items.length > 60){
    return NextResponse.json({ error: "Send at most 60 divisions per request." }, { status: 413, headers: CORS });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data, error } = await supabase.rpc("ingest_entry_lists", { p_token: token, p_items: items });

  if(error){
    const badToken = /invalid ingest token/i.test(error.message || "");
    return NextResponse.json(
      { error: badToken ? "That ingest token is not recognised." : error.message },
      { status: badToken ? 401 : 500, headers: CORS }
    );
  }

  return NextResponse.json(data || { received: 0, changed: 0 }, { headers: CORS });
}
