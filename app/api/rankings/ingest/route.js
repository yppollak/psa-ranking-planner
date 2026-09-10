import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Where the browser extension delivers captured world rankings. Same personal
// ingest token as the entry lists; no session, so it works from an extension.
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

  const division = String((body && body.division) || "").toLowerCase();
  if(division !== "men" && division !== "women"){
    return NextResponse.json({ error: 'division must be "men" or "women".' }, { status: 400, headers: CORS });
  }

  const rankedOn = String((body && body.ranked_on) || "");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(rankedOn)){
    return NextResponse.json({ error: "ranked_on must be a YYYY-MM-DD date." }, { status: 400, headers: CORS });
  }

  const rows = Array.isArray(body && body.rows) ? body.rows : null;
  if(!rows){
    return NextResponse.json({ error: 'Expected {"rows": [...]}.' }, { status: 400, headers: CORS });
  }
  if(rows.length > 600){
    return NextResponse.json({ error: "Send at most 600 players per request." }, { status: 413, headers: CORS });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  // One id per division per run, so the final call can delete exactly the rows
  // this capture did not write — including a previous attempt at the same week.
  const captureId = String((body && body.capture_id) || "").slice(0, 64) || null;

  const { data, error } = await supabase.rpc("ingest_rankings", {
    p_token: token,
    p_division: division,
    p_ranked_on: rankedOn,
    p_rows: rows,
    p_final: !!(body && body.final),
    p_capture_id: captureId,
  });

  if(error){
    const badToken = /invalid ingest token/i.test(error.message || "");
    return NextResponse.json(
      { error: badToken ? "That ingest token is not recognised." : error.message },
      { status: badToken ? 401 : 500, headers: CORS }
    );
  }

  return NextResponse.json(data || { received: 0, removed: 0, stored: 0 }, { headers: CORS });
}
