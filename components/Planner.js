"use client";
import { useEffect, useRef } from "react";
import { MARKUP } from "../lib/planner/markup";
import { createClient } from "../lib/supabase/client";
export default function Planner({ user, isAdmin }){
  const mounted = useRef(false);
  useEffect(() => { if(mounted.current) return; mounted.current = true;
    import("../lib/planner/app.js").then(m => m.mountPlanner({ supabase: createClient(), user, isAdmin })); }, [user, isAdmin]);
  return <div id="planner-root" dangerouslySetInnerHTML={{ __html: MARKUP }} />;
}
