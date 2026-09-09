// Ranking engine — mirrors the workbook formulas exactly. Pure functions, no DOM.
import { DATA } from "./data.js";
export const ROUNDS = DATA.rounds, REGIONS = DATA.regions, SIZES = Object.keys(DATA.points);
export const DEFAULT_MATRIX = {"North America":[1,2,3,3,4,5,5],"Central America":[2,1,2,4,5,5,5],"South America":[3,2,1,4,4,5,5],"Europe":[3,4,4,1,2,3,5],"Africa":[4,5,4,2,1,3,5],"Asia":[4,5,5,3,4,1,3],"Oceania":[4,5,5,4,5,3,1]};
export const $ = (s, el) => (el || document).querySelector(s);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export const dnum = iso => { if(!iso) return null; const [y,m,d] = iso.split("-").map(Number); return Math.round(Date.UTC(y, m-1, d) / 86400000); };
export const iso = n => new Date(n * 86400000).toISOString().slice(0,10);
export const todayN = () => { const t = new Date(); return Math.round(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / 86400000); };
export const fmtD = n => { if(n == null) return ""; const d = new Date(n*86400000); return d.toLocaleDateString("en-GB", {day:"2-digit", month:"short", year:"numeric", timeZone:"UTC"}); };
export const fmtN = (v, dp=2) => (Math.round(v*100)/100).toLocaleString("en-US", {minimumFractionDigits:0, maximumFractionDigits:dp});
export const round2 = v => Math.round(v*100)/100;
export const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "player";
export const uid = () => Math.random().toString(36).slice(2, 9);


export function refPts(size, round){ const row = DATA.points[size]; if(!row) return null; const i = ROUNDS.indexOf(round); return i < 0 ? null : row[i]; }
export function pointsFor(r, perf){
  if(!r.size || !DATA.points[r.size]) return 0;
  if(r.exact){ const v = refPts(r.size, r.exact); return v == null ? 0 : v; }
  if(r.rfrom && r.rto){
    const a = ROUNDS.indexOf(r.rfrom), b = ROUNDS.indexOf(r.rto); if(a < 0 || b < 0) return 0;
    const vals = DATA.points[r.size].slice(Math.min(a,b), Math.max(a,b)+1).filter(x => x != null);
    return vals.length ? vals.reduce((s,x) => s+x, 0) / vals.length : 0;
  }
  const v = refPts(r.size, (perf||{})[r.size]); return v == null ? 0 : v;
}
export const divisorFor = n => n <= 15 ? 11 : n - 4;
export function rankPos(avg, rankings){ if(!rankings || !rankings.length) return null; const a = round2(avg); return rankings.filter(r => r.average > a).length + 1; }
// items: [{d (day number|null), pts, incl}] in table order. Ties broken by table order, like the workbook.
export function scenario(items, rankings, asOf){
  // asOf lets callers ask "where would this stand on date X"; defaults to today.
  const today = (asOf == null) ? todayN() : asOf;
  const inclDates = items.filter(i => i.incl && i.d != null).map(i => i.d);
  const end = Math.max(today, ...inclDates), start = end - 364;
  items.forEach(i => { i.inwin = !!(i.incl && i.d != null && i.d >= start && i.d <= end); });
  const inw = items.filter(i => i.inwin);
  inw.forEach((i, idx) => { i.prank = inw.filter(j => j.pts > i.pts).length + inw.slice(0, idx).filter(j => j.pts === i.pts).length + 1; });
  const played = inw.length, divisor = divisorFor(played);
  items.forEach(i => { i.counting = i.inwin && i.prank <= divisor; });
  const total = inw.filter(i => i.prank <= divisor).reduce((s,i) => s + i.pts, 0);
  const avg = divisor ? total / divisor : 0;
  return { start, end, played, divisor, total, avg, rank: rankPos(avg, rankings) };
}
export function autoPerf(avg){ // deepest round whose points <= average; else the last round that exists at that level
  const out = {};
  for(const size of SIZES){ const row = DATA.points[size]; let pick = null;
    for(let i = 0; i < row.length; i++){ if(row[i] != null && row[i] <= avg){ pick = ROUNDS[i]; break; } }
    if(!pick){ for(let i = row.length-1; i >= 0; i--){ if(row[i] != null){ pick = ROUNDS[i]; break; } } }
    out[size] = pick; }
  return out;
}
