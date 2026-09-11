"use client";
import { useState } from "react";
import { createClient } from "../lib/supabase/client";
export default function SignIn(){
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function go(){ setBusy(true); setErr(""); const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/auth/callback" } });
    if(error){ setErr(error.message); setBusy(false); } }
  return (
    <div className="signin">
      <div className="card">
        <div className="brand" style={{ marginBottom: 14 }}><svg className="mark" viewBox="0 0 64 64" width="34" height="34" aria-hidden="true"><rect x="4" y="4" width="56" height="56" rx="13" className="mk-tile"/><path d="M15 49C15 27 27 15 49 15" fill="none" className="mk-flight" strokeLinecap="round"/><circle cx="46" cy="46" r="6.75" className="mk-ball"/></svg><h1>Tour<span> Advisor</span></h1></div>
        <p>Decide which tournaments to enter: points on offer, points you're defending, your divisor, and how far you'd travel. Your profile is private to you.</p>
        <button className="gbtn" onClick={go} disabled={busy}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.5 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6.1C12.3 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.8-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.7-4.1-13.6-9.9l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
          {busy ? "Opening Google…" : "Sign in with Google"}
        </button>
        {err ? <div className="msg warn">{err}</div> : null}
      </div>
    </div>
  );
}
