"use client";
import { DATA } from "./data.js";
import { ROUNDS, REGIONS, SIZES, DEFAULT_MATRIX, $, esc, dnum, iso, todayN, fmtD, fmtN, round2, slug, uid, refPts, pointsFor, divisorFor, rankPos, scenario, autoPerf } from "./engine.js";

/* ---------- state & storage ---------- */
const state = { players: {}, active: null, shared: {}, tab: "planner", filters: { q:"", cont:"", size:"", enter:"", floor:true, past:false, restricted:false }, rq: "" };
let ctx = null, saveTimers = {};
const LS_ACTIVE = "psa-planner-active";
function setSaveState(t){ const el = $("#saveState"); if(el) el.textContent = t; }
function rememberActive(){ try { localStorage.setItem(LS_ACTIVE, state.active || ""); } catch(e){} }
async function loadAll(){
  const [pl, sh] = await Promise.all([ctx.supabase.from("players").select("id,owner,name,data"), ctx.supabase.from("shared").select("key,data")]);
  if(pl.error) throw pl.error; if(sh.error) throw sh.error;
  state.players = {}; pl.data.forEach(r => { const p = normalize(Object.assign({}, r.data, { id: r.id, owner: r.owner, name: r.name })); state.players[p.id] = p; });
  state.shared = {}; sh.data.forEach(r => { state.shared[r.key] = r.data.value; if(r.data.date) state.shared[r.key + "Date"] = r.data.date; });
  let act = null; try { act = localStorage.getItem(LS_ACTIVE); } catch(e){}
  state.active = (act && state.players[act]) ? act : (Object.keys(state.players).sort((a,b) => state.players[a].name.localeCompare(state.players[b].name))[0] || null);
}
function savePlayer(p){ clearTimeout(saveTimers[p.id]); setSaveState("Saving…");
  saveTimers[p.id] = setTimeout(async () => { const row = { id: p.id, owner: p.owner || ctx.user.id, name: p.name, data: JSON.parse(JSON.stringify(p)), updated_at: new Date().toISOString() };
    const { error } = await ctx.supabase.from("players").upsert(row); if(error){ setSaveState("Could not save — " + error.message); console.warn(error); } else setSaveState("Saved"); }, 500); }
async function saveSharedKey(key){ const { error } = await ctx.supabase.from("shared").upsert({ key, data: { value: state.shared[key], date: state.shared[key + "Date"] || null }, updated_at: new Date().toISOString() }); if(error) throw error; }
async function deletePlayer(id){ delete state.players[id]; const { error } = await ctx.supabase.from("players").delete().eq("id", id); if(error){ console.warn(error); toast("Could not delete: " + error.message); } }

function newPlayer(o){ const id = slug(o.name) + "-" + uid().slice(0,4);
  return { id, owner: ctx.user.id, name: o.name, gender: o.gender || "M", home: o.home || "Europe", notes: o.notes || "",
    card: { counting: null, played: null, average: null, rank: null, date: "" },
    perf: autoPerf(0), matrix: JSON.parse(JSON.stringify(DEFAULT_MATRIX)), played: [], planner: {}, playedIncl: {}, custom: [] }; }
function normalize(p){ p.odds = p.odds || {}; p.planner = p.planner || {}; p.playedIncl = p.playedIncl || {}; p.custom = p.custom || []; p.played = p.played || []; p.card = p.card || {}; p.perf = p.perf || autoPerf(0); p.matrix = p.matrix || JSON.parse(JSON.stringify(DEFAULT_MATRIX)); return p; }
const P = () => state.players[state.active];

/* ---------- derived data ---------- */
const schedule = () => state.shared.schedule || DATA.schedule;
// Captured rankings (the whole list, from the extension) beat the CSV snapshot,
// which beats the bundled sample. Only the captured list carries played counts
// for everyone, which is what the honest average needs.
const captured = { men: null, women: null, meta: null, tried: false };
const rankingsFor = g => g === "W"
  ? (captured.women || state.shared.rankingsW || null)
  : (captured.men || state.shared.rankings || DATA.rankings);
const rankingsSource = g => (g === "W" ? captured.women : captured.men) ? "captured"
  : (g === "W" ? state.shared.rankingsW : state.shared.rankings) ? "csv" : "bundled";
// Total points over tournaments played, nothing dropped. The official average
// keeps only the best 11, or the best played−4 once past 15, so under 11 played
// it is harsher (the gap is filled with zeros) and above 11 it is kinder.
// No smoothing for a small sample, deliberately: a player who leaves college at
// 24, enters two events and wins both is ranked 500th by the divisor but is
// genuinely a top-100 player, and this number is what says so.
const honestAvg = r => (r && r.played > 0 && r.total != null)
  ? Number(r.total) / Number(r.played) : null;
function pool(p){ const g = p.gender || "M";
  const rows = schedule().filter(s => s.gender === g || s.gender === "MW").map(s => Object.assign({ fromSchedule: true }, s));
  (p.custom || []).forEach(c => rows.push(Object.assign({ fromSchedule: false, gender: g, status: "custom" }, c)));
  rows.sort((a,b) => a.start < b.start ? -1 : a.start > b.start ? 1 : a.name.localeCompare(b.name));
  return rows.map(s => { const o = p.planner[s.id] || {}; const r = Object.assign({}, s, { use: !!o.use, enter: o.enter || "No", exact: o.exact || "", rfrom: o.rfrom || "", rto: o.rto || "", notes: o.notes || "" });
    r.pts = pointsFor(r, p.perf); r.d = dnum(r.start); r.tier = tierFor(p, r.continent); return r; }); }
function tierFor(p, cont){ const row = p.matrix[p.home]; const i = REGIONS.indexOf(cont); return (row && i >= 0) ? row[i] : 0; }
function histRows(p){ return p.played.map(h => Object.assign({}, h, { pts: pointsFor(h, p.perf), d: dnum(h.date) })).sort((a,b) => (a.d||0) - (b.d||0)); }
function playedRows(p){ // manual history + auto rows from Planner (Enter = Yes / Planned), in date order = PlanSeq
  const manual = histRows(p).map(h => Object.assign(h, { kind: "manual", incl: h.use !== false }));
  const auto = pool(p).filter(r => r.enter === "Yes" || r.enter === "Planned").map(r => ({ kind: "auto", id: r.id, date: r.start, d: r.d, name: r.name, location: r.location, size: r.size, enter: r.enter, exact: r.exact, rfrom: r.rfrom, rto: r.rto, pts: r.pts, incl: !!p.playedIncl[r.id] }));
  return manual.concat(auto); }
function plannerScenario(p){ const items = histRows(p).map(h => ({ d: h.d, pts: h.pts, incl: true })).concat(pool(p).filter(r => r.use).map(r => ({ d: r.d, pts: r.pts, incl: true }))); return scenario(items, rankingsFor(p.gender)); }
function playedScenario(p){ const rows = playedRows(p); const items = rows.map(r => ({ d: r.d, pts: r.pts, incl: r.incl })); const s = scenario(items, rankingsFor(p.gender)); rows.forEach((r,i) => Object.assign(r, { inwin: items[i].inwin, prank: items[i].prank, counting: items[i].counting })); s.rows = rows;
  s.checkedPts = rows.filter(r => r.incl).reduce((a,r) => a + r.pts, 0); s.checkedN = rows.filter(r => r.incl).length; return s; }
function floorInfo(p){ const s = playedScenario(p); const avg = (p.card && p.card.average != null && p.card.average !== "") ? Number(p.card.average) : s.avg; const played = (p.card && p.card.played) ? Number(p.card.played) : s.played;
  if(played < 11) return { active: false, avg, played, size: null };
  const size = SIZES.find(sz => DATA.points[sz][0] >= avg) || null; return { active: true, avg, played, size }; }

/* ---------- rendering ---------- */
function render(){ const p = P(); document.body.classList.toggle("no-player", !p); if(!p){ renderPlayerSel(); return; } renderPlayerSel(); loadCapturedRankings(); loadEntryLists(); renderStrip(); ({ planner: renderPlanner, played: renderPlayed, calendar: renderCalendar, settings: renderSettings, points: renderPoints, rankings: renderRankings })[state.tab](); }
function renderPlayerSel(){ const sel = $("#playerSel"); sel.hidden = Object.keys(state.players).length < 2; sel.innerHTML = Object.values(state.players).sort((a,b) => a.name.localeCompare(b.name)).map(p => `<option value="${esc(p.id)}"${p.id === state.active ? " selected" : ""}>${esc(p.name)}</option>`).join(""); }
function renderStrip(){ const p = P(); const usePlanner = state.tab === "planner"; const s = usePlanner ? plannerScenario(p) : playedScenario(p); const c = p.card || {};
  // The triangle means better or worse, not bigger or smaller — a rank going
  // 100 → 93 is an improvement even though the number fell. "flat" is for the
  // figures that move without that being good or bad news either way.
  const delta = (v, ref, inv) => { if(ref == null || ref === "" || v == null) return ""; const d = v - Number(ref); if(Math.abs(d) < 0.005) return `<span class="delta">= card</span>`;
    if(inv === "flat") return `<span class="delta flat">${d > 0 ? "\u25B2" : "\u25BC"} ${fmtN(Math.abs(d))}</span>`;
    const up = inv ? d < 0 : d > 0; return `<span class="delta ${up ? "up" : "down"}">${up ? "\u25B2" : "\u25BC"} ${fmtN(Math.abs(d))}</span>`; };
  $("#strip").innerHTML = `
    <div class="tile"><span class="eyebrow">Counting points</span><span class="v num">${fmtN(s.total)}</span>${delta(s.total, c.counting)}</div>
    <div class="tile"><span class="eyebrow">Played (in window)</span><span class="v num">${s.played}</span>${delta(s.played, c.played, "flat")}</div>
    <div class="tile"><span class="eyebrow">Divisor</span><span class="v num">${s.divisor}</span>${c.played ? delta(s.divisor, divisorFor(Number(c.played)), true) : `<span class="d">${s.played <= 15 ? "11 until 16 played" : "played − 4"}</span>`}</div>
    <div class="tile"><span class="eyebrow">Average</span><span class="v num">${fmtN(s.avg)}</span>${delta(s.avg, c.average)}</div>
    <div class="tile rank"><span class="eyebrow">Projected rank</span><span class="v num">${s.rank == null ? "—" : "#" + s.rank}</span>${delta(s.rank, c.rank, true)}</div>
    <div class="tile"><span class="eyebrow">Window</span><span class="v num" style="font-size:18px;padding-top:6px">${fmtD(s.start)} → ${fmtD(s.end)}</span><span class="d">rolls with the latest ticked event</span></div>`;
  // The tile takes the colour so the number itself stays a number.
  document.querySelectorAll("#strip .tile").forEach(t => { const d = t.querySelector(".delta");
    t.classList.toggle("good", !!(d && d.classList.contains("up")));
    t.classList.toggle("bad", !!(d && d.classList.contains("down"))); });
  const note = $("#cardNote");
  if(note){ const has = c.counting != null || c.average != null || c.rank != null;
    note.hidden = !has;
    note.textContent = has ? `Compared with your official card${c.date ? " of " + fmtD(dnum(c.date)) : ""}.` : ""; }
  fillPinbar(p, s, c, delta);
  const f = floorInfo(p);
  $("#stripNote").textContent = (usePlanner ? "Planner projection: all played results plus every ticked Planner row. " : "Played scenario: only ticked rows count, inside the rolling 365-day window. ") + (f.active ? `Sensible floor: ${f.size} (a win there beats the current average of ${fmtN(f.avg)}).` : `Fewer than 11 counted tournaments — the average is diluted by zeros, so no floor is applied.`); }

/* ---------- date clashes between events you intend to play ---------- */
// Overlapping dates are impossible; a one-day turnaround is possible but means
// a flight and no rest, so it is worth saying out loud rather than hiding.
const CLASH_GAP = 3;   // days between events that still counts as too tight
function clashPairs(p){
  const evs = pool(p).filter(r => r.enter === "Yes" || r.enter === "Planned")
    .map(r => ({ id: r.id, name: r.name, a: r.d, b: dnum(r.end || r.start) }))
    .filter(r => r.a != null && r.b != null)
    .sort((x, y) => x.a - y.a);
  const out = [];
  for(let i = 0; i < evs.length; i++){
    for(let j = i + 1; j < evs.length; j++){
      const x = evs[i], y = evs[j];
      if(y.a > x.b + CLASH_GAP) break;      // sorted by start: nothing later can reach back
      out.push({ x, y, kind: y.a <= x.b ? "hard" : "soft", gap: y.a - x.b - 1 });
    }
  }
  return out;
}
function renderClashes(p){
  const bar = $("#clashBar"); if(!bar) return {};
  const pairs = clashPairs(p);
  const marks = {};
  const gapLabel = g => g === 0 ? "back to back" : `gap: ${g} day${g === 1 ? "" : "s"}`;
  pairs.forEach(({ x, y, kind, gap }) => {
    const label = kind === "hard" ? "clash" : gapLabel(gap);
    [x.id, y.id].forEach(id => {
      const cur = marks[id];
      if(!cur || (cur.kind !== "hard" && (kind === "hard" || gap < cur.gap))) marks[id] = { kind, gap, label };
    });
  });
  bar.hidden = !pairs.length;
  // A busy schedule can throw up a dozen of these; the rows themselves are
  // marked, so the bar only needs to show enough to make the point.
  const SHOW = 6;
  const listed = pairs.slice().sort((a, b) => (a.kind === b.kind ? a.gap - b.gap : a.kind === "hard" ? -1 : 1)).slice(0, SHOW);
  bar.innerHTML = listed.map(({ x, y, kind, gap }) => {
    const what = kind === "hard"
      ? `${esc(x.name)} and ${esc(y.name)} overlap.`
      : gap === 0
        ? `${esc(y.name)} starts the day after ${esc(x.name)} ends.`
        : `Only ${gap} day${gap === 1 ? "" : "s"} between ${esc(x.name)} and ${esc(y.name)}.`;
    return `<div class="row"><span class="tag ${kind}">${kind === "hard" ? "clash" : gapLabel(gap)}</span>`
      + `<span>${what} ${fmtD(x.a)} → ${fmtD(x.b)} · ${fmtD(y.a)} → ${fmtD(y.b)}</span></div>`;
  }).join("")
  + (pairs.length > SHOW ? `<div class="row"><span></span><span class="more">and ${pairs.length - SHOW} more — marked on the rows below.</span></div>` : "");
  return marks;
}
/* ---------- pinned summary bar ---------- */
// Editing a row changes the numbers; without this you have to scroll back up to
// see what changed. Only on the two tabs where rows are edited.
function fillPinbar(p, s, c, delta){
  const nums = $("#pinNums"); if(!nums) return;
  // Colour rides on the value here — there is no tile to tint in a single line —
  // while the movement itself stays grey so the two never fight.
  const tiles = Array.from(document.querySelectorAll("#strip .tile")).slice(0, 5);
  const labels = ["counting", "played", "divisor", "avg", "rank"];
  nums.innerHTML = tiles.map((t, i) => {
    const d = t.querySelector(".delta");
    const dir = d && d.classList.contains("up") ? "up" : d && d.classList.contains("down") ? "down" : "";
    const moved = d && d.textContent.trim() && d.textContent.trim() !== "= card" ? d.textContent.trim() : "";
    return `<span class="m"><b class="${dir}">${esc(t.querySelector(".v").textContent)}</b>${labels[i]}`
      + (moved ? ` <span class="dl">${esc(moved)}</span>` : "") + `</span>`;
  }).join("")
  + `<span class="who">${esc(p.name)} · ${state.tab === "planner" ? "Planner" : "Played"}${c.date ? " · vs card " + fmtD(dnum(c.date)) : ""}</span>`;
  const tabs = $("#pinTabs");
  if(tabs && !tabs.childElementCount){
    tabs.innerHTML = Array.from(document.querySelectorAll("#tabs .tab"))
      .map(t => `<button type="button" data-tab="${esc(t.dataset.tab)}">${esc(t.textContent)}</button>`).join("");
    tabs.addEventListener("click", e => { const b = e.target.closest("button"); if(!b) return;
      const real = document.querySelector(`#tabs .tab[data-tab="${b.dataset.tab}"]`); if(real) real.click(); });
  }
  if(tabs) tabs.querySelectorAll("button").forEach(b => b.classList.toggle("sel", b.dataset.tab === state.tab));
}
const PIN_TABS = ["planner", "played"];
function pinVisibility(){
  const bar = $("#pinbar"), strip = $("#strip");
  if(!bar || !strip) return;
  const past = strip.getBoundingClientRect().bottom <= 0;
  bar.hidden = !(past && PIN_TABS.includes(state.tab));
}
function watchPin(){
  window.addEventListener("scroll", pinVisibility, { passive: true });
  window.addEventListener("resize", pinVisibility);
  pinVisibility();
}

/* ---------- the tab blurbs, behind a ? ---------- */
function setupIntros(){
  document.querySelectorAll("p.intro").forEach(p => {
    if(p.previousElementSibling && p.previousElementSibling.classList.contains("introbtn")) return;
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "introbtn"; btn.textContent = "?";
    btn.setAttribute("aria-expanded", "false");
    btn.title = "What this tab does";
    p.hidden = true;
    p.parentNode.insertBefore(btn, p);
    btn.addEventListener("click", () => {
      p.hidden = !p.hidden;
      btn.setAttribute("aria-expanded", String(!p.hidden));
    });
  });
}

// A <details> holding checkboxes: a filter you can tick several of, without a
// library and without hand-positioning a popup.
function fillMulti(sel, values, chosen, label){
  const el = $(sel); if(!el) return;
  const menu = el.querySelector(".menu");
  if(!menu.childElementCount){
    menu.innerHTML = values.map(v => `<label><input type="checkbox" value="${esc(v)}"> ${esc(v)}</label>`).join("")
      + `<button type="button" class="clear">Clear</button>`;
  }
  menu.querySelectorAll("input").forEach(i => { i.checked = chosen.includes(i.value); });
  el.querySelector("summary b").textContent =
    !chosen.length ? "All" : chosen.length === 1 ? chosen[0] : `${chosen[0]} +${chosen.length - 1}`;
  el.querySelector("summary .lbl").hidden = chosen.length > 0;
}

function selOpts(list, cur, blank){ return (blank ? `<option value="">${blank}</option>` : "") + list.map(v => `<option${v === cur ? " selected" : ""}>${esc(v)}</option>`).join(""); }
function renderPlanner(){ const p = P(), f = state.filters, today = todayN(), fl = floorInfo(p);
  fillMulti("#fCont", REGIONS.concat("TBA"), f.cont, "Continent");
  fillMulti("#fSize", SIZES, f.size, "Size");
  let rows = pool(p); const q = f.q.trim().toLowerCase();
  rows = rows.filter(r => (f.past || r.d >= today || r.use || r.enter !== "No") && (f.restricted || !r.restricted || r.enter !== "No" || r.use) && (!f.cont.length || f.cont.includes(r.continent)) && (!f.size.length || f.size.includes(r.size)) && (!f.enter || r.enter === f.enter) && (!q || (r.name + " " + r.location).toLowerCase().includes(q)) && (!(f.floor && fl.active) || r.use || r.enter !== "No" || DATA.points[r.size][0] >= fl.avg));
  const clashMarks = renderClashes(p);
  $("#pCount").textContent = `${rows.length} tournaments`;
  const tb = $("#plannerTbl tbody"); tb.innerHTML = rows.map(r => { const below = fl.active && DATA.points[r.size][0] < fl.avg; const ent = r.d < today ? ` <small>${r.status === "custom" ? "added manually" : r.status}</small>` : (r.status && r.status !== "Upcoming" && r.status !== "custom" ? ` <small>${esc(r.status)}${r.restricted ? " · restricted draw" : ""}</small>` : (r.restricted ? " <small>restricted draw</small>" : ""));
    return `<tr data-id="${esc(r.id)}" class="${r.use ? "used" : ""}${below ? " below" : ""}${r.enter === "No" ? " noenter" : ""}${clashMarks[r.id] ? " clash-" + clashMarks[r.id].kind : ""}">
      <td><input type="checkbox" data-k="use" ${r.use ? "checked" : ""} aria-label="Use ${esc(r.name)}"></td>
      <td class="num" style="white-space:nowrap">${fmtD(r.d)}</td>
      <td class="tname">${esc(r.name)}${clashMarks[r.id] ? `<span class="rowtag ${clashMarks[r.id].kind}">${esc(clashMarks[r.id].label)}</span>` : ""}${ent}</td>
      <td><span class="tier tier-${r.tier}" title="Travel difficulty ${r.tier || "n/a"} of 5">${esc(r.continent)}</span></td>
      <td class="loc">${esc(r.location)}</td>
      <td>${r.fromSchedule ? esc(r.size) : `<select data-k="size">${selOpts(SIZES, r.size)}</select>`}</td>
      <td><select data-k="enter">${selOpts(["Yes","No","Planned"], r.enter)}</select></td>
      <td><select data-k="exact">${selOpts(ROUNDS, r.exact, "—")}</select></td>
      <td><select data-k="rfrom">${selOpts(ROUNDS, r.rfrom, "—")}</select></td>
      <td><select data-k="rto">${selOpts(ROUNDS, r.rto, "—")}</select></td>
      <td class="r num"><b>${fmtN(r.pts)}</b></td>
      <td class="r fieldcell">${fieldCell(r, p)}</td>
      <td><input type="text" class="notes-in" data-k="notes" value="${esc(r.notes)}" placeholder="…"></td>
      <td>${r.fromSchedule ? "" : `<button class="del" data-del="1" title="Remove">×</button>`}</td></tr>`; }).join("");
  $("#plannerLegend").innerHTML = `<span>Travel difficulty from <b>${esc(p.home)}</b>:</span>` + [1,2,3,4,5].map(t => `<span><i class="sw tier-${t}" style="background:var(--t${t})"></i>${["","1 — easiest","2 — near","3 — medium","4 — far","5 — hardest"][t]}</span>`).join("") + `<span><i class="sw" style="background:var(--surface-2)"></i>TBA</span><span style="margin-left:auto">Points precedence: exact result › range average › expected round from Settings.</span>`; }

function renderPlayed(){ const p = P(), s = playedScenario(p), today = todayN();
  const kv = (pairs) => pairs.map(([k,v]) => `<b class="num">${v}</b><span>${k}</span>`).join("");
  const dead = s.rows.filter(r => r.incl && !r.counting).length;
  $("#playedCount").textContent = `${p.played.length} results · ${s.rows.length - p.played.length} pulled from the Planner`
    + (dead ? ` · ${dead} not counting` : "");
  let out = "", seenToday = false, seenYear = false;
  s.rows.forEach(r => { if(!seenToday && r.d != null && r.d > today){ seenToday = true; out += `<tr class="divider today"><td colspan="15">▲ today ▲</td></tr>`; } if(!seenYear && r.d != null && r.d > today + 365){ seenYear = true; out += `<tr class="divider year"><td colspan="15">▲ 1 year mark ▲</td></tr>`; }
    const manual = r.kind === "manual"; const cls = (manual ? "" : "auto") + (r.incl && !r.inwin ? " expired" : "") + (r.incl && r.inwin && !r.counting ? " dropped" : "");
    out += `<tr data-kind="${r.kind}" data-id="${esc(r.id)}" class="${cls}">
      <td><input type="checkbox" data-k="incl" ${r.incl ? "checked" : ""} aria-label="Include ${esc(r.name)}"></td>
      <td class="num" style="white-space:nowrap">${manual ? `<input type="date" data-k="date" value="${esc(r.date)}">` : fmtD(r.d)}</td>
      <td class="tname">${manual ? `<input type="text" data-k="name" value="${esc(r.name)}">` : esc(r.name)}</td>
      <td>${manual ? `<input type="text" data-k="location" value="${esc(r.location || "")}">` : esc(r.location)}</td>
      <td>${manual ? `<select data-k="size">${selOpts(SIZES, r.size, "—")}</select>` : esc(r.size)}</td>
      <td>${manual ? `<select data-k="enter">${selOpts(["Yes","No","Planned"], r.enter)}</select>` : esc(r.enter)}</td>
      <td>${manual ? `<select data-k="exact">${selOpts(ROUNDS, r.exact, "—")}</select>` : esc(r.exact || "—")}</td>
      <td>${manual ? `<select data-k="rfrom">${selOpts(ROUNDS, r.rfrom, "—")}</select>` : esc(r.rfrom || "—")}</td>
      <td>${manual ? `<select data-k="rto">${selOpts(ROUNDS, r.rto, "—")}</select>` : esc(r.rto || "—")}</td>
      <td class="r num"><b>${fmtN(r.pts)}</b></td>
      <td class="num" style="white-space:nowrap">${r.d == null ? "" : fmtD(r.d + 364)}</td>
      <td>${r.incl ? (r.counting ? `<span class="pill counting">Yes</span>` : `<span class="pill no">No</span>`) : ""}</td>
      <td>${r.incl ? (r.inwin ? `<span class="pill yes">Yes</span>` : `<span class="pill no">No</span>`) : ""}</td>
      <td class="r num">${r.inwin ? r.prank : ""}</td>
      <td>${manual ? `<button class="del" data-del="1" title="Remove">×</button>` : ""}</td></tr>`; });
  if(!s.rows.length) out = `<tr><td colspan="15" class="na">No results yet — add your counting history with “+ Add result”, or import a planner workbook in Settings.</td></tr>`;
  $("#playedTbl tbody").innerHTML = out; }

function renderCalendar(){ const p = P(), today = todayN(); const t = new Date(today*86400000);
  const first = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1) / 86400000; const lastMonth = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 12, 0)); const last = Math.round(lastMonth.getTime() / 86400000);
  const dow = n => new Date(n*86400000).getUTCDay(); let cur = first - dow(first); const endWeek = last + (6 - dow(last));
  const evs = pool(p).filter(r => r.enter === "Yes" || r.enter === "Planned").map(r => { const s = r.d; let e = r.end ? dnum(r.end) : null; if(e == null || e < s) e = s - dow(s) + 6; return { name: r.name, st: r.enter === "Yes" ? "yes" : "plan", s, e, maybe: e + 1 }; });
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  let html = `<div class="cal-head"><div>Month</div>${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => `<div>${d}</div>`).join("")}<div>Tournaments this week</div></div>`;
  let lastLabel = "";
  for(let w = cur; w <= endWeek; w += 7){ let label = ""; for(let d = w; d < w + 7; d++){ const dt = new Date(d*86400000); if(dt.getUTCDate() === 1 || d === cur){ const l = months[dt.getUTCMonth()] + " " + dt.getUTCFullYear(); if(l !== lastLabel){ label = l; lastLabel = l; } } }
    const [mn, yr] = label.split(" ");
    let days = ""; for(let d = w; d < w + 7; d++){ const dt = new Date(d*86400000); let cls = "day"; if(dt.getUTCDate() === 1) cls += " newmonth"; if(d === today) cls += " today";
      const hit = evs.find(e => e.st === "yes" && d >= e.s && d <= e.e) || evs.find(e => e.st === "plan" && d >= e.s && d <= e.e); const mb = !hit && (evs.find(e => e.st === "yes" && e.maybe === d) || evs.find(e => e.st === "plan" && e.maybe === d));
      if(hit) cls += " " + hit.st; else if(mb) cls += " " + mb.st + "-m"; if(d < first || d > last) cls += " out";
      days += `<div class="${cls}">${dt.getUTCDate()}</div>`; }
    const inWeek = evs.filter(e => e.s <= w + 6 && e.e >= w); html += `<div class="cal-week"><div class="m">${mn ? esc(mn) : ""}${yr ? `<small>${yr}</small>` : ""}</div>${days}<div class="ev">${inWeek.map(e => `<span><i class="${e.st}"></i>${esc(e.name)}</span>`).join("")}</div></div>`; }
  $("#cal").innerHTML = html; }

function renderSettings(){ const p = P(); $("#sName").value = p.name; $("#sGender").value = p.gender || "M"; const sh = $("#sHome"); sh.innerHTML = selOpts(REGIONS, p.home); $("#sNotes").value = p.notes || "";
  const c = p.card || {}; $("#cCounting").value = c.counting ?? ""; $("#cPlayed").value = c.played ?? ""; $("#cAverage").value = c.average ?? ""; $("#cRank").value = c.rank ?? ""; $("#cDate").value = c.date || "";
  const s = playedScenario(p); const items = []; if(c.counting != null && c.counting !== "") items.push(`counting ${fmtN(s.total)} vs card ${fmtN(c.counting)}`); if(c.played) items.push(`played ${s.played} vs ${c.played}`); if(c.average) items.push(`average ${fmtN(s.avg)} vs ${fmtN(c.average)}`); if(c.rank) items.push(`rank ${s.rank == null ? "—" : "#" + s.rank} vs #${c.rank}`);
  const ok = items.length && (c.counting == null || c.counting === "" || Math.abs(s.total - c.counting) < 0.01) && (!c.played || s.played === Number(c.played)) && (!c.rank || s.rank === Number(c.rank));
  $("#reconcile").innerHTML = items.length ? (ok ? `<span style="color:var(--yes)">✓ Played tab reconciles with the official card</span> — ${items.join(" · ")}` : `<span class="warn">Played tab does not match the card</span> — ${items.join(" · ")}. Check the history: a missing result, a wrong category, or a withdrawal that should not be listed.`) : "Enter the official card to reconcile the Played tab against it.";
  $("#perfTbl tbody").innerHTML = SIZES.map(sz => { const v = refPts(sz, p.perf[sz]); return `<tr><td class="hd">${esc(sz)}</td><td><select data-perf="${esc(sz)}">${selOpts(ROUNDS, p.perf[sz])}</select></td><td class="r num">${v == null ? `<span class="na">n/a at this level</span>` : fmtN(v)}</td></tr>`; }).join("");
  renderFieldPrefs();
  const fl = floorInfo(p); $("#floorMsg").textContent = fl.active ? `Current average ${fmtN(fl.avg)} → floor ${fl.size}.` : `Average ${fmtN(fl.avg)} on ${fl.played} played — no floor until 11 tournaments.`;
  $("#matrixTbl").innerHTML = `<thead><tr><th>From \\ To</th>${REGIONS.map(r => `<th>${esc(r.replace(" America"," Am."))}</th>`).join("")}</tr></thead><tbody>` + REGIONS.map(from => `<tr${from === p.home ? ' style="background:var(--surface-2)"' : ""}><td class="hd">${esc(from)}${from === p.home ? " ★" : ""}</td>${REGIONS.map((to, j) => `<td><input type="number" min="1" max="5" data-mf="${esc(from)}" data-mj="${j}" value="${p.matrix[from][j]}"></td>`).join("")}</tr>`).join("") + `</tbody>`;  loadIngestPanel(); }

function renderPoints(){ $("#pointsTbl").innerHTML = `<thead><tr><th>Category</th>${ROUNDS.map(r => `<th class="r">${esc(r)}</th>`).join("")}</tr></thead><tbody>` + SIZES.map(sz => `<tr><td class="hd" style="font-weight:500">${esc(sz)}</td>${DATA.points[sz].map(v => `<td class="r num">${v == null ? `<span class="na">—</span>` : fmtN(v)}</td>`).join("")}</tr>`).join("") + "</tbody>"; }

function renderRankings(){ const p = P(); const rk = rankingsFor(p.gender); const s = playedScenario(p);
  if(!rk){ $("#rankIntro").textContent = "No women's rankings loaded yet. Run the PSA Sync extension, or import a CSV under Settings → Replace rankings with columns rank, name, country, code, total, counting, average, played."; $("#rankTbl tbody").innerHTML = ""; $("#rCount").textContent = ""; return; }
  const src = rankingsSource(p.gender), tour = p.gender === "W" ? "Women's" : "Men's";
  const meta = captured.meta && captured.meta[p.gender === "W" ? "women" : "men"];
  $("#rankIntro").textContent = src === "captured"
    ? `${tour} PSA World Rankings, captured in full on ${meta ? meta.ranked_on : "an earlier run"} — every ranked player, with the honest average (total points ÷ tournaments played, nothing dropped) alongside the official one.`
    : `${tour} PSA World Rankings snapshot (${state.shared.rankingsDate || DATA.rankingsDate}). Ranks 1–200 exact; beyond that sampled anchors. Run the PSA Sync extension for the full list and honest averages.`;
  const grossTotal = (s.rows || []).filter(r => r.inwin).reduce((a, r) => a + r.pts, 0);
  const q = state.rq.trim().toLowerCase();
  const you = { rank: s.rank, name: `${p.name} — projected (Played tab)`, country: "", total: grossTotal, counting: s.total, average: s.avg, played: s.played, you: true };
  let rows = rk.filter(r => !q || (r.name + " " + (r.country || "")).toLowerCase().includes(q)); if(!q && s.rank != null){ const i = rows.findIndex(r => r.rank >= s.rank); rows = rows.slice(); rows.splice(i < 0 ? rows.length : i, 0, you); }
  const LIMIT = 400, over = rows.length > LIMIT;
  let shown = rows.slice(0, LIMIT);
  // Never lose the player's own row to the cut-off — someone ranked 900th still
  // wants to see where they sit.
  if(over && !shown.some(r => r.you) && rows.some(r => r.you)) shown = shown.slice(0, LIMIT - 1).concat(rows.find(r => r.you));
  $("#rCount").textContent = over ? `${rk.length} players · showing ${LIMIT}, search to narrow` : `${rk.length} players`;
  $("#rankTbl tbody").innerHTML = shown.map(r => { const h = honestAvg(r);
    return `<tr${r.you ? ' style="background:var(--yes-soft);font-weight:600"' : ""}><td class="r num">${r.you ? "→ #" + r.rank : r.rank}</td><td>${esc(r.name)}</td><td>${esc(r.country || "")}${r.code ? ` <span class="na">${esc(r.code)}</span>` : ""}</td><td class="r num">${r.total === "" || r.total == null ? "" : fmtN(r.total)}</td><td class="r num">${fmtN(r.counting)}</td><td class="r num">${fmtN(r.average)}</td><td class="r num">${h == null ? `<span class="na">—</span>` : fmtN(h)}</td><td class="r num">${r.played}</td></tr>`; }).join(""); }

/* ---------- entry lists: ingest token + capture stats ---------- */
function supa(){ return (typeof ctx !== "undefined" && ctx && ctx.supabase) ? ctx.supabase : null; }
let ingestTokenValue = "";
async function loadIngestPanel(){
  const inp = $("#ingestToken"); if(!inp) return;
  const card = inp.closest(".card"); const sb = supa();
  if(!sb){ if(card) card.hidden = true; return; }
  if(card) card.hidden = false;
  if(!ingestTokenValue){
    try { const { data, error } = await sb.rpc("my_ingest_token"); if(error) throw error; ingestTokenValue = data || ""; }
    catch(e){ $("#tokenMsg").innerHTML = `<span class="warn">Could not load your token: ${esc(e.message)}. Has entries.sql been run in Supabase?</span>`; }
  }
  inp.value = ingestTokenValue;
  loadEntryStats();
}
async function loadEntryStats(){
  const el = $("#entryStats"), msg = $("#entryStatsMsg"), sb = supa();
  if(!el || !sb) return;
  try {
    const { data, error } = await sb.from("entry_lists").select("tournament_slug,division_id,captured_at");
    if(error) throw error;
    const tourneys = new Set(data.map(r => r.tournament_slug)).size;
    const last = data.reduce((m, r) => (r.captured_at > m ? r.captured_at : m), "");
    const men = (captured.meta && captured.meta.men) || null, women = (captured.meta && captured.meta.women) || null;
    el.innerHTML = `<b class="num">${tourneys}</b><span>tournaments</span><b class="num">${data.length}</b><span>draws</span>`
      + `<b class="num" style="font-size:15px">${last ? new Date(last).toLocaleString() : "—"}</b><span>last capture</span>`
      + `<b class="num">${men ? men.players : "—"}</b><span>men ranked${men ? ` (${men.ranked_on})` : ""}</span>`
      + `<b class="num">${women ? women.players : "—"}</b><span>women ranked${women ? ` (${women.ranked_on})` : ""}</span>`;
    msg.textContent = data.length ? "" : "Nothing captured yet. Install the extension, paste the token above, and press Refresh now.";
  } catch(e){ el.innerHTML = ""; msg.innerHTML = `<span class="warn">Could not read entry lists: ${esc(e.message)}</span>`; }
}

// The full ranking list is a few thousand rows, so it is fetched once per
// session, in the background, and the page redrawn when it lands.
const RANK_PAGE = 1000;
async function loadCapturedRankings(){
  if(captured.tried) return; captured.tried = true;
  const sb = supa(); if(!sb) return;
  try {
    const { data: summary, error } = await sb.rpc("rankings_summary");
    if(error) throw error;
    captured.meta = summary || {};
    for(const div of ["men", "women"]){
      const info = captured.meta[div];
      if(!info || !info.players) continue;
      const rows = [];
      for(let from = 0; from < info.players + RANK_PAGE; from += RANK_PAGE){
        const r = await sb.from("rankings").select("rank,name,country,total,counting,average,played,divisor")
          .eq("division", div).order("rank", { ascending: true }).order("name", { ascending: true })
          .range(from, from + RANK_PAGE - 1);
        if(r.error) throw r.error;
        // Postgres numerics arrive as strings; the ranking maths compares them.
        rows.push(...r.data.map(x => Object.assign({}, x, {
          total: x.total == null ? null : Number(x.total),
          counting: x.counting == null ? null : Number(x.counting),
          average: x.average == null ? 0 : Number(x.average),
        })));
        if(r.data.length < RANK_PAGE) break;
      }
      if(rows.length) captured[div] = rows;
    }
    if(captured.men || captured.women) render();
    else loadEntryStats();
  } catch(e){ console.warn("captured rankings:", e && e.message); }
}


// One cell per tournament: what the simulation thinks it is worth, and where you
// would slot into the draw. Blank when we have no entry list for that event.
const PLANNER_RUNS = 1200;
function fieldCell(r, p){
  if(!fields.lists) return "";
  const a = analyse(r, p, PLANNER_RUNS);
  if(!a) return `<span class="na" title="No entry list captured for this tournament">—</span>`;
  if(a.chalk && a.chalk.reserve) return `<button class="fieldbtn" data-field="${esc(r.id)}" title="Open the field">reserve #${a.chalk.reserve}</button>`;
  if(!a.sim) return `<button class="fieldbtn" data-field="${esc(r.id)}">field</button>`;
  const diff = a.sim.expected - r.pts;
  const cls = Math.abs(diff) < 1 ? "" : diff > 0 ? "up" : "down";
  return `<button class="fieldbtn ${cls}" data-field="${esc(r.id)}" title="Seed ${a.field.mine.pos} of ${a.field.draw} · click for the full field">`
    + `<b>${fmtN(Math.round(a.sim.expected))}</b><span>#${a.field.mine.pos}</span></button>`;
}

/* ---------- field strength ---------- */
// Entry lists come from the PSA Sync extension; rankings give every entrant a
// strength. Everything below is a different way of answering the same question:
// what is this tournament worth to me.

const FIELD_MIN = 1;          // a player with no results is not literally zero
let fieldK = 2;               // P(A beats B) = sA^k / (sA^k + sB^k)
let fieldBasis = "honest";    // "honest" = total / played, "official" = the ranking average
const SIM_RUNS = 4000;

const fields = { lists: null, tried: false, index: null };

const normTitle = s => String(s || "").toLowerCase()
  .replace(/[‘’'`]/g, "")
  .replace(/\b(19|20)\d\d\b/g, " ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();
const titleTokens = s => new Set(normTitle(s).split(" ").filter(w => w.length > 2));
function titleSim(a, b){
  const A = titleTokens(a), B = titleTokens(b);
  if(!A.size || !B.size) return 0;
  let hit = 0; A.forEach(w => { if(B.has(w)) hit++; });
  return hit / Math.min(A.size, B.size);
}
const normPerson = s => String(s || "").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

// Match a schedule row to a captured entry list: same tour, near-identical dates,
// then the best title overlap. Dates do most of the work; the title breaks ties.
function matchList(row, gender){
  if(!fields.lists) return null;
  const want = gender === "W" ? "women" : "men";
  const d = dnum(row.start);
  let best = null, bestSim = 0;
  fields.lists.forEach(L => {
    if(!/^(men|women)/i.test(L.division_name || "")) return;
    if((L.division_name || "").toLowerCase().indexOf(want) !== 0) return;
    const ld = L.start_date ? dnum(L.start_date) : null;
    if(ld == null || Math.abs(ld - d) > 3) return;
    const sim = titleSim(row.name, L.tournament_name);
    if(sim > bestSim){ bestSim = sim; best = L; }
  });
  return bestSim >= 0.34 ? best : null;
}

function rankingIndex(gender){
  const rk = rankingsFor(gender) || [];
  const byName = new Map(), byRank = new Map();
  rk.forEach(r => {
    byName.set(normPerson(r.name), r);
    if(!byRank.has(r.rank)) byRank.set(r.rank, []);
    byRank.get(r.rank).push(r);
  });
  return { byName, byRank };
}
function strengthOf(r){
  if(!r) return null;
  const v = fieldBasis === "official" ? Number(r.average) : (honestAvg(r) || 0);
  return Math.max(Number.isFinite(v) ? v : 0, FIELD_MIN);
}

// One entrant, resolved against the rankings. Name first: both datasets come
// from PSA so it is reliable, and world ranking is a fallback for anyone whose
// name is spelt differently between the two pages.
function rateEntry(e, idx, odds){
  const r = idx.byName.get(normPerson(e.name))
    || (e.wr != null && (idx.byRank.get(e.wr) || []).length === 1 ? idx.byRank.get(e.wr)[0] : null);
  const key = oddsKey(e);
  const own = odds && odds[key];
  return { name: e.name, nat: e.nat, seed: e.seed, wr: e.wr, playerId: e.playerId, key,
           ranked: !!r, rank: r ? r.rank : null, played: r ? r.played : null,
           s: r ? strengthOf(r) : FIELD_MIN,
           myP: own && own.p != null ? Number(own.p) : null };
}

// Your own read of a matchup, kept by PSA player id where there is one and by
// name otherwise, so it follows the opponent from tournament to tournament.
const oddsKey = e => e.playerId ? "id:" + e.playerId : "n:" + normPerson(e.name);
function setOdds(p, entrant, prob){
  p.odds = p.odds || {};
  if(prob == null) delete p.odds[entrant.key];
  else p.odds[entrant.key] = { p: prob, name: entrant.name, at: iso(todayN()) };
  savePlayer(p); clearFieldCache();
}

const nextPow2 = n => { let p = 1; while(p < n) p *= 2; return Math.min(p, 64); };
const bandLabel = n => ROUNDS.find(r => r.endsWith("(" + n + ")")) || null;
function bandPoints(size, n){
  const lbl = bandLabel(n); if(!lbl) return 0;
  const v = DATA.points[size] && DATA.points[size][ROUNDS.indexOf(lbl)];
  return v == null ? 0 : v;
}
// Standard seeding: 1 plays the lowest seed, 2 is at the far end, and so on.
function seedOrder(n){
  let a = [1];
  while(a.length < n){ const m = a.length * 2 + 1, b = []; a.forEach(x => b.push(x, m - x)); a = b; }
  return a;
}

function buildField(list, p){
  const idx = rankingIndex(p.gender);
  const odds = p.odds || {};
  const main = (list.entries || []).filter(e => e.section === "main").map(e => rateEntry(e, idx, odds));
  const me = { name: p.name, mine: true, ranked: false, s: FIELD_MIN };
  const mineRow = main.find(e => normPerson(e.name) === normPerson(p.name));
  if(mineRow){ mineRow.mine = true; }
  else {
    const own = (rankingsFor(p.gender) || []).find(r => normPerson(r.name) === normPerson(p.name));
    if(own){ me.ranked = true; me.rank = own.rank; me.played = own.played; me.s = strengthOf(own); }
    else { const sc = playedScenario(p); me.s = Math.max(sc.played > 0 ? sc.checkedPts / sc.played : sc.avg, FIELD_MIN); me.derived = true; }
    main.push(me);
  }
  main.sort((a, b) => b.s - a.s);
  main.forEach((e, i) => { e.pos = i + 1; });
  const draw = nextPow2(Math.max(main.length - (mineRow ? 0 : 1), 2));
  return { entrants: main, draw, mine: main.find(e => e.mine), unrated: main.filter(e => !e.ranked).length };
}

function pWin(a, b){
  const x = Math.pow(a, fieldK), y = Math.pow(b, fieldK);
  return (x + y) <= 0 ? 0.5 : x / (x + y);
}
// Your figure wins over the model's for matches you are in — it is your
// judgement, so the upset dial does not touch it. Matches between two other
// players stay with the model, since you have no view on those.
function matchP(a, b){
  if(a.mine && b.myP != null) return b.myP;
  if(b.mine && a.myP != null) return 1 - a.myP;
  return pWin(a.s, b.s);
}

// Ten thousand draws is overkill for a 32 field; four is inside a point either way.
function simulate(field, size, runs = SIM_RUNS){
  const draw = field.draw;
  const seeded = field.entrants.slice(0, draw);
  const order = seedOrder(draw);
  const slots = order.map(seed => seeded[seed - 1] || null);
  const meSlot = slots.findIndex(x => x && x.mine);
  const bands = {};
  if(meSlot < 0) return null;
  for(let run = 0; run < runs; run++){
    let alive = slots.slice();
    while(alive.length > 1){
      const next = [];
      for(let i = 0; i < alive.length; i += 2){
        const a = alive[i], b = alive[i + 1];
        if(!a && !b){ next.push(null); continue; }
        if(!a || !b){ next.push(a || b); continue; }
        const aWins = Math.random() < matchP(a, b);
        const w = aWins ? a : b, l = aWins ? b : a;
        if(l.mine) bands[alive.length] = (bands[alive.length] || 0) + 1;
        next.push(w);
      }
      alive = next;
      if(!alive.some(x => x && x.mine)) break;
    }
    if(alive.length === 1 && alive[0] && alive[0].mine) bands[1] = (bands[1] || 0) + 1;
  }
  const out = Object.entries(bands).map(([n, c]) => ({ n: +n, c, p: c / runs, pts: bandPoints(size, +n) }))
    .sort((a, b) => a.n - b.n);
  const expected = out.reduce((s, r) => s + r.p * r.pts, 0);
  const likely = out.slice().sort((a, b) => b.c - a.c)[0] || null;
  return { bands: out, expected, likely };
}

// Chalk: no upsets. With standard seeding the top two make the final, the top
// four the semis, the top eight the quarters — so your seed alone tells you
// where you land if the draw goes to form.
function chalkFinish(field, size){
  if(!field.mine) return null;
  const seed = field.mine.pos;
  if(seed > field.draw) return { reserve: seed - field.draw, pts: 0, label: null };
  const band = nextPow2(seed);
  return { band, pts: bandPoints(size, band), label: bandLabel(band), reserve: 0 };
}

function fieldSummary(field){
  const others = field.entrants.filter(e => !e.mine);
  const sorted = others.slice().sort((a, b) => b.s - a.s);
  const mean = arr => arr.length ? arr.reduce((t, e) => t + e.s, 0) / arr.length : 0;
  return {
    n: others.length,
    mean: mean(sorted),
    top8: mean(sorted.slice(0, 8)),
    strongest: sorted[0] || null,
    above: field.mine ? others.filter(e => e.s > field.mine.s).length : null,
    unrated: field.unrated,
  };
}

// Everything about one tournament, from every angle we have. Cached, because the
// Planner asks for a hundred of these on every redraw.
const fieldCache = new Map();
function analyse(row, p, runs){
  const list = matchList(row, p.gender);
  if(!list) return null;
  const key = [list.tournament_slug, list.division_id, p.id, p.gender, fieldBasis, fieldK, row.size, runs].join("|");
  if(fieldCache.has(key)) return fieldCache.get(key);
  const field = buildField(list, p);
  const out = {
    list, field,
    summary: fieldSummary(field),
    chalk: chalkFinish(field, row.size),
    sim: simulate(field, row.size, runs),
    yours: pointsFor(row, p.perf),
    captured: list.captured_at,
  };
  fieldCache.set(key, out);
  return out;
}
function clearFieldCache(){ fieldCache.clear(); }

/* ---------- the field, in full ---------- */
const DETAIL_RUNS = 8000;
function analyseBoth(row, p, runs){
  const keep = fieldBasis;
  fieldBasis = "honest";  const honest = analyse(row, p, runs);
  fieldBasis = "official"; const official = analyse(row, p, runs);
  fieldBasis = keep;
  return { honest, official };
}
function bandName(n){
  return { 1: "Winner", 2: "Final", 4: "Semi-final", 8: "Quarter-final",
           16: "Round of 16", 32: "Round of 32", 64: "Round of 64" }[n] || ("last " + n);
}
function fieldModal(row, p){
  const both = analyseBoth(row, p, DETAIL_RUNS);
  const a = both[fieldBasis === "official" ? "official" : "honest"];
  if(!a) return;
  const other = both[fieldBasis === "official" ? "honest" : "official"];
  const su = a.summary, mine = a.field.mine;
  const money = v => v == null ? "—" : fmtN(Math.round(v * 10) / 10);

  const chalk = a.chalk && a.chalk.reserve
    ? `<b>Reserve #${a.chalk.reserve}</b><span>you would not make the draw</span>`
    : a.chalk ? `<b>${money(a.chalk.pts)}</b><span>${bandName(a.chalk.band)} · seed ${mine.pos}</span>` : `<b>—</b><span></span>`;
  const exp = a.sim ? `<b>${money(a.sim.expected)}</b><span>over ${DETAIL_RUNS.toLocaleString()} draws</span>` : `<b>—</b><span>not in the draw</span>`;
  const like = a.sim && a.sim.likely
    ? `<b>${bandName(a.sim.likely.n)}</b><span>${Math.round(a.sim.likely.p * 100)}% of the time</span>` : `<b>—</b><span></span>`;
  const yours = `<b>${money(a.yours)}</b><span>your expected round for ${esc(row.size)}</span>`;
  const strength = `<b>${money(su.mean)}</b><span>field average · top 8 ${money(su.top8)}</span>`;
  const seat = mine
    ? `<b>${su.above} above you</b><span>of ${su.n} entered${su.unrated ? ` · ${su.unrated} unrated` : ""}</span>`
    : `<b>—</b><span></span>`;

  const dist = a.sim ? a.sim.bands.slice().sort((x, y) => x.n - y.n).map(b =>
    `<div class="distrow${a.sim.likely && b.n === a.sim.likely.n ? " top" : ""}"><span class="dn">${bandName(b.n)}</span><i style="width:${Math.max(1, b.p * 100)}%"></i>`
    + `<span class="dp">${(b.p * 100).toFixed(b.p < 0.1 ? 1 : 0)}%</span><span class="dpts">${money(b.pts)}</span></div>`).join("") : "";

  const gap = (a.sim && other && other.sim) ? a.sim.expected - other.sim.expected : null;

  const meS = mine ? mine.s : FIELD_MIN;
  const rowsHtml = a.field.entrants.map(e => {
    const model = e.mine ? null : Math.round(pWin(meS, e.s) * 100);
    return `<tr class="${e.mine ? "me" : ""}${e.pos > a.field.draw ? " out" : ""}">
      <td class="r num">${e.pos}</td>
      <td>${esc(e.name)}${e.mine ? " <b>(you)</b>" : ""}${e.nat ? ` <span class="na">${esc(e.nat)}</span>` : ""}</td>
      <td class="r num">${e.rank == null ? `<span class="na">unrated</span>` : "#" + e.rank}</td>
      <td class="r num">${e.ranked ? money(e.s) : `<span class="na">—</span>`}</td>
      <td class="r num">${e.played == null ? "" : e.played}</td>
      <td class="r num">${e.mine ? "" : `<span class="${e.myP != null ? "na" : ""}">${model}%</span>`}</td>
      <td class="r">${e.mine ? "" : `<input class="oddsin${e.myP != null ? " set" : ""}" type="number" min="0" max="100" step="1"
        data-odds="${esc(e.key)}" value="${e.myP != null ? Math.round(e.myP * 100) : ""}" placeholder="${model}" aria-label="Your chance against ${esc(e.name)}">`}</td>
    </tr>`; }).join("");

  modal(`<h2>${esc(row.name)}</h2>
    <p>${esc(row.size)} · ${fmtD(row.d)} → ${fmtD(dnum(row.end || row.start))} · ${esc(row.location)} · draw of ${a.field.draw}, ${su.n} entered.
       Entry list captured ${a.captured ? new Date(a.captured).toLocaleDateString() : "—"}.</p>
    <div class="methods">
      <div class="mth"><span class="eyebrow">Chalk</span>${chalk}</div>
      <div class="mth"><span class="eyebrow">Expected points</span>${exp}</div>
      <div class="mth"><span class="eyebrow">Most likely</span>${like}</div>
      <div class="mth"><span class="eyebrow">Your own estimate</span>${yours}</div>
      <div class="mth"><span class="eyebrow">Field strength</span>${strength}</div>
      <div class="mth"><span class="eyebrow">Where you sit</span>${seat}</div>
    </div>
    ${gap == null ? "" : `<p class="basisnote">On ${fieldBasis === "official" ? "official" : "honest"} averages this reads ${money(a.sim.expected)}; on ${fieldBasis === "official" ? "honest" : "official"} it reads ${money(other.sim.expected)}.
      ${Math.abs(gap) < 1 ? "The two agree, so the field's ranking reflects its consistency." :
        gap > 0 ? "The field is ranked above its consistency — beatable." : "The field is more consistent than its ranking suggests."}</p>`}
    <h3>How far you get</h3>
    <div class="dist">${dist || `<span class="na">You are not in the draw.</span>`}</div>
    <h3>The field</h3>
    <p class="hint">Type your own chance of beating anyone in the last column. It replaces the model for that player, is remembered against them wherever they enter next, and is not touched by the upset dial. Clear the box to hand them back to the model.</p>
    <div class="twrap" style="max-height:320px"><table class="mini fieldtbl"><thead><tr>
      <th class="r">#</th><th>Player</th><th class="r">Rank</th><th class="r">Strength</th><th class="r">Played</th>
      <th class="r" title="What the model gives you against this player">Model</th>
      <th class="r" title="Your own figure — overrides the model, and is remembered for this player">You win %</th>
    </tr></thead><tbody>${rowsHtml}</tbody></table></div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" id="fmClose">Close</button></div>`, "wide");
  $("#fmClose").addEventListener("click", () => { $("#modalRoot").innerHTML = ""; });
  // Open on your own row: in a draw of 32 you are rarely near the top.
  const meRow = document.querySelector("table.fieldtbl tr.me");
  if(meRow) meRow.scrollIntoView({ block: "center" });
  const tbl = document.querySelector("table.fieldtbl");
  if(tbl) tbl.addEventListener("change", ev => {
    const inp = ev.target.closest("[data-odds]"); if(!inp) return;
    const ent = a.field.entrants.find(x => x.key === inp.dataset.odds); if(!ent) return;
    const raw = inp.value.trim();
    const pct = raw === "" ? null : Math.min(100, Math.max(0, Number(raw)));
    setOdds(p, ent, pct == null ? null : pct / 100);
    fieldModal(row, p);          // redraw with the new number folded in
  });
}

// Entry lists arrive from the extension; pull them once per session.
async function loadEntryLists(){
  if(fields.tried) return; fields.tried = true;
  const sb = supa(); if(!sb) return;
  try {
    const rows = []; const PAGE = 200;
    for(let from = 0; ; from += PAGE){
      const r = await sb.from("entry_lists")
        .select("tournament_slug,division_id,tournament_name,division_name,level,start_date,end_date,status,entries,captured_at")
        .range(from, from + PAGE - 1);
      if(r.error) throw r.error;
      rows.push(...r.data);
      if(r.data.length < PAGE) break;
    }
    fields.lists = rows;
    render();
  } catch(e){ console.warn("entry lists:", e && e.message); }
}

/* ---------- field model settings ---------- */
const LS_FIELD = "psa-field-model";
function loadFieldPrefs(){
  try { const o = JSON.parse(localStorage.getItem(LS_FIELD) || "{}");
    if(o.basis === "honest" || o.basis === "official") fieldBasis = o.basis;
    if(o.k >= 1 && o.k <= 3) fieldK = o.k;
  } catch(e){}
}
function saveFieldPrefs(){ try { localStorage.setItem(LS_FIELD, JSON.stringify({ basis: fieldBasis, k: fieldK })); } catch(e){} }
function renderFieldPrefs(){
  const b = $("#fBasis"), k = $("#fK"), m = $("#fKMsg");
  if(!b || !k) return;
  b.value = fieldBasis; k.value = fieldK;
  // Anchor the dial to something you can actually judge: a player with twice
  // your average should beat you how often?
  const twice = Math.pow(2, fieldK) / (Math.pow(2, fieldK) + 1);
  if(m) m.textContent = `k = ${fieldK.toFixed(1)} — someone with double your average wins ${Math.round(twice * 100)}% of the time. Equal averages are always 50/50.`;
}

/* ---------- events ---------- */
function bind(){
  loadFieldPrefs(); setupIntros(); watchPin();
  $("#tabs").addEventListener("click", e => { const b = e.target.closest(".tab"); if(!b) return; state.tab = b.dataset.tab; document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", t === b)); document.querySelectorAll(".panel").forEach(pn => pn.classList.toggle("active", pn.id === "panel-" + state.tab)); render(); pinVisibility(); });
  $("#playerSel").addEventListener("change", e => { state.active = e.target.value; rememberActive(); render(); });
  $("#emptyNewBtn").addEventListener("click", newPlayerModal);
  $("#newPlayerBtn").addEventListener("click", newPlayerModal);
  // planner filters
  $("#pSearch").addEventListener("input", e => { state.filters.q = e.target.value; renderPlanner(); });
  $("#fEnter").addEventListener("change", e => { state.filters.enter = e.target.value; renderPlanner(); });
  [["fCont","cont"],["fSize","size"]].forEach(([id,k]) => {
    const el = $("#"+id);
    el.addEventListener("change", e => { if(e.target.type !== "checkbox") return;
      const v = e.target.value, cur = state.filters[k];
      state.filters[k] = e.target.checked ? cur.concat(v) : cur.filter(x => x !== v);
      renderPlanner(); });
    el.addEventListener("click", e => { if(!e.target.classList.contains("clear")) return;
      state.filters[k] = []; el.open = false; renderPlanner(); });
  });
  // Click anywhere else and any open filter menu closes.
  document.addEventListener("click", e => {
    document.querySelectorAll("details.multi[open]").forEach(d => { if(!d.contains(e.target)) d.open = false; });
  });
  [["fFloor","floor"],["fPast","past"],["fRestricted","restricted"]].forEach(([id,k]) => $("#"+id).addEventListener("change", e => { state.filters[k] = e.target.checked; renderPlanner(); }));
  $("#addCustomBtn").addEventListener("click", customModal);
  $("#plannerTbl").addEventListener("change", e => { const tr = e.target.closest("tr"); if(!tr) return; const p = P(), id = tr.dataset.id, k = e.target.dataset.k; if(!k) return;
    const custom = p.custom.find(c => c.id === id); if(k === "size" && custom){ custom.size = e.target.value; } else { const o = p.planner[id] = p.planner[id] || {}; o[k] = e.target.type === "checkbox" ? e.target.checked : e.target.value; if(k === "enter" && o.enter === "No") delete o.enter; if(!o[k] && k !== "use") delete o[k]; if(!Object.keys(o).length) delete p.planner[id]; }
    savePlayer(p); renderStrip(); if(k === "use" || k === "enter" || k === "size") renderPlanner(); else { const row = pool(p).find(r => r.id === id); tr.querySelector("td.r b").textContent = fmtN(row.pts); } });
  $("#plannerTbl").addEventListener("click", e => {
    const fb = e.target.closest("[data-field]");
    if(fb){ const r = pool(P()).find(x => x.id === fb.dataset.field); if(r) fieldModal(r, P()); return; }
    if(!e.target.dataset.del) return; const p = P(), id = e.target.closest("tr").dataset.id; p.custom = p.custom.filter(c => c.id !== id); delete p.planner[id]; delete p.playedIncl[id]; savePlayer(p); render(); });
  // played
  $("#addPlayedBtn").addEventListener("click", () => { const p = P(); p.played.push({ id: "h" + uid(), date: iso(todayN()), name: "New result", location: "", size: "Challenger 6", enter: "Yes", exact: "", rfrom: "", rto: "", use: true }); savePlayer(p); render(); setTimeout(() => { const last = document.querySelector(`#playedTbl tr[data-id="${p.played[p.played.length-1].id}"] input[data-k=name]`); if(last) last.focus(); }, 0); });
  $("#playedTbl").addEventListener("change", e => { const tr = e.target.closest("tr"); if(!tr || !e.target.dataset.k) return; const p = P(), k = e.target.dataset.k;
    if(tr.dataset.kind === "auto"){ if(k === "incl"){ if(e.target.checked) p.playedIncl[tr.dataset.id] = true; else delete p.playedIncl[tr.dataset.id]; } }
    else { const h = p.played.find(x => x.id === tr.dataset.id); if(!h) return; if(k === "incl") h.use = e.target.checked; else h[k] = e.target.value; }
    savePlayer(p); render(); });
  $("#playedTbl").addEventListener("click", e => { if(!e.target.dataset.del) return; const p = P(), id = e.target.closest("tr").dataset.id; if(!confirm("Remove this result from the history?")) return; p.played = p.played.filter(h => h.id !== id); savePlayer(p); render(); });
  // settings
  const sv = () => { const p = P(); savePlayer(p); renderPlayerSel(); renderStrip(); };
  $("#sName").addEventListener("change", e => { P().name = e.target.value.trim() || P().name; sv(); });
  $("#sGender").addEventListener("change", e => { P().gender = e.target.value; sv(); renderSettings(); });
  $("#sHome").addEventListener("change", e => { P().home = e.target.value; sv(); renderSettings(); });
  $("#sNotes").addEventListener("change", e => { P().notes = e.target.value; sv(); });
  [["cCounting","counting"],["cPlayed","played"],["cAverage","average"],["cRank","rank"],["cDate","date"]].forEach(([id,k]) => $("#"+id).addEventListener("change", e => { const p = P(); p.card = p.card || {}; p.card[k] = k === "date" ? e.target.value : (e.target.value === "" ? null : Number(e.target.value)); sv(); renderSettings(); }));
  $("#perfTbl").addEventListener("change", e => { if(!e.target.dataset.perf) return; P().perf[e.target.dataset.perf] = e.target.value; sv(); renderSettings(); });
  $("#perfAutoBtn").addEventListener("click", () => { const p = P(); p.perf = autoPerf(floorInfo(p).avg); sv(); renderSettings(); toast("Expected rounds derived from the current average"); });
  $("#matrixTbl").addEventListener("change", e => { const f = e.target.dataset.mf; if(!f) return; const v = Math.min(5, Math.max(1, Number(e.target.value) || 1)); P().matrix[f][Number(e.target.dataset.mj)] = v; e.target.value = v; sv(); });
  $("#matrixResetBtn").addEventListener("click", () => { P().matrix = JSON.parse(JSON.stringify(DEFAULT_MATRIX)); sv(); renderSettings(); });
  $("#deletePlayerBtn").addEventListener("click", async () => { const p = P(); if(!confirm(`Delete ${p.name} and all of their data? This cannot be undone.`)) return; await deletePlayer(p.id); state.active = Object.keys(state.players)[0] || null; rememberActive(); render(); });
  $("#xlsxFile").addEventListener("change", e => importXlsx(e.target.files[0], P()));
  $("#exportBtn").addEventListener("click", exportPlayer);
  $("#jsonFile").addEventListener("change", e => { const f = e.target.files[0]; if(!f) return; f.text().then(t => { const p = normalize(JSON.parse(t)); if(!p.name) throw new Error("no name"); p.id = slug(p.name) + "-" + uid().slice(0,4); p.owner = ctx.user.id; state.players[p.id] = p; state.active = p.id; rememberActive(); savePlayer(p); render(); toast(`Imported ${p.name}`); }).catch(() => { $("#dataMsg").innerHTML = `<span class="warn">That file is not a player export from this planner.</span>`; }); e.target.value = ""; });
  $("#schedFile").addEventListener("change", e => importScheduleCsv(e.target.files[0]));
  $("#rankFile").addEventListener("change", e => importRankingsCsv(e.target.files[0]));
  $("#rSearch").addEventListener("input", e => { state.rq = e.target.value; renderRankings(); });
  const fb = $("#fBasis"); if(fb) fb.addEventListener("change", e => { fieldBasis = e.target.value; saveFieldPrefs(); clearFieldCache(); renderFieldPrefs(); render(); });
  const fk = $("#fK"); if(fk) fk.addEventListener("input", e => { fieldK = Number(e.target.value); renderFieldPrefs(); });
  if(fk) fk.addEventListener("change", () => { saveFieldPrefs(); clearFieldCache(); render(); });
  const revealBtn = $("#tokenRevealBtn");
  if(revealBtn) revealBtn.addEventListener("click", () => { const i = $("#ingestToken"); if(!i) return;
    const hidden = i.type === "password"; i.type = hidden ? "text" : "password"; revealBtn.textContent = hidden ? "Hide" : "Reveal"; });
  const copyBtn = $("#tokenCopyBtn");
  if(copyBtn) copyBtn.addEventListener("click", async () => {
    if(!ingestTokenValue){ $("#tokenMsg").textContent = "No token loaded yet."; return; }
    try { await navigator.clipboard.writeText(ingestTokenValue); toast("Token copied"); $("#tokenMsg").textContent = "Copied. Paste it into the extension."; }
    catch(e){ const i = $("#ingestToken"); if(i){ i.type = "text"; i.focus(); i.select(); } $("#tokenMsg").textContent = "Select the token above and press Ctrl+C."; } });
}
function toast(t){ const el = document.createElement("div"); el.className = "toast"; el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), 2600); }
function modal(html, cls){ const root = $("#modalRoot"); root.innerHTML = `<div class="modal-bg"><div class="modal ${cls || ""}" role="dialog">${html}</div></div>`; root.querySelector(".modal-bg").addEventListener("click", e => { if(e.target.classList.contains("modal-bg")) root.innerHTML = ""; }); return root; }
function newPlayerModal(){ const root = modal(`<h2>New player</h2><p>Each player gets their own Planner, history, calendar and settings. Where they live decides travel difficulty — ask, don't assume from nationality.</p>
  <div class="form"><label for="npName">Name</label><input id="npName" type="text" placeholder="Full name">
  <label for="npGender">Tour</label><select id="npGender"><option value="M">Men's</option><option value="W">Women's</option></select>
  <label for="npHome">Home region</label><select id="npHome">${selOpts(REGIONS, "Europe")}</select>
  <label>Start from</label><div><label class="chk"><input type="radio" name="npMode" value="blank" checked> Empty — add results on the Played tab</label><br><label class="chk"><input type="radio" name="npMode" value="xlsx"> Import a planner workbook (.xlsx)</label><input type="file" id="npFile" accept=".xlsx" style="margin-top:6px"></div></div>
  <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" id="npCancel">Cancel</button><button class="btn primary" id="npCreate">Create player</button></div>`);
  $("#npCancel").addEventListener("click", () => root.innerHTML = "");
  $("#npCreate").addEventListener("click", async () => { const name = $("#npName").value.trim(); const file = $("#npFile").files[0]; const mode = root.querySelector("input[name=npMode]:checked").value; if(mode === "xlsx" && !file){ alert("Choose the .xlsx workbook first."); return; } if(!name && mode !== "xlsx"){ $("#npName").focus(); return; }
    const p = newPlayer({ name: name || "Imported player", gender: $("#npGender").value, home: $("#npHome").value }); state.players[p.id] = p; state.active = p.id; rememberActive(); root.innerHTML = ""; if(mode === "xlsx") await importXlsx(file, p, name); else { savePlayer(p); state.tab = "played"; document.querySelector('.tab[data-tab="played"]').click(); } render(); }); }
function customModal(){ const root = modal(`<h2>Add a tournament</h2><p>For an event that is not in the schedule snapshot. It behaves like any other Planner row.</p>
  <div class="form"><label for="ctName">Name</label><input id="ctName" type="text"><label for="ctStart">Start</label><input id="ctStart" type="date" value="${iso(todayN())}"><label for="ctEnd">End</label><input id="ctEnd" type="date"><label for="ctLoc">Location</label><input id="ctLoc" type="text" placeholder="City, Country"><label for="ctCont">Continent</label><select id="ctCont">${selOpts(REGIONS.concat("TBA"), "Europe")}</select><label for="ctSize">Size</label><select id="ctSize">${selOpts(SIZES, "Challenger 6")}</select></div>
  <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" id="ctCancel">Cancel</button><button class="btn primary" id="ctAdd">Add</button></div>`);
  $("#ctCancel").addEventListener("click", () => root.innerHTML = "");
  $("#ctAdd").addEventListener("click", () => { const name = $("#ctName").value.trim(); if(!name || !$("#ctStart").value){ $("#ctName").focus(); return; } const p = P(); p.custom.push({ id: "c" + uid(), name, start: $("#ctStart").value, end: $("#ctEnd").value || "", location: $("#ctLoc").value.trim() || "TBA", continent: $("#ctCont").value, size: $("#ctSize").value, restricted: false }); savePlayer(p); root.innerHTML = ""; render(); }); }

/* ---------- imports / exports ---------- */
function cellV(ws, addr){ const c = ws[addr]; return c ? c.v : undefined; }
function cellHasFormula(ws, addr){ const c = ws[addr]; return !!(c && c.f); }
let XLSXref = null;
function toIso(v){ if(v instanceof Date) return iso(Math.round((Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())) / 86400000)); if(typeof v === "number"){ const d = XLSXref && XLSXref.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}` : ""; } if(typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0,10); return ""; }
async function importXlsx(file, p, forcedName){ if(!file) return; const msg = $("#dataMsg");
  try { const XLSX = await import("xlsx"); XLSXref = XLSX; const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true, cellFormula: true });
    const pl = wb.Sheets["Played"], pn = wb.Sheets["Planner"], ps = wb.Sheets["PerfSettings"]; if(!pl || !pn) throw new Error("This workbook has no Planner / Played tabs.");
    const title = String(cellV(pn, "A1") || ""); const m = title.match(/^(.+?)\s+[—-]\s+Tournament Planner/); if(!forcedName && m) p.name = m[1].trim();
    p.played = []; for(let r = 9; r < 400; r++){ const b = cellV(pl, "B" + r); if(b === undefined || b === "" || cellHasFormula(pl, "B" + r)) break; const use = cellV(pl, "R" + r);
      p.played.push({ id: "h" + uid(), date: toIso(b), name: String(cellV(pl, "C" + r) || ""), location: String(cellV(pl, "E" + r) || ""), size: String(cellV(pl, "F" + r) || ""), enter: String(cellV(pl, "G" + r) || "Yes"), exact: String(cellV(pl, "H" + r) || ""), rfrom: String(cellV(pl, "I" + r) || ""), rto: String(cellV(pl, "J" + r) || ""), use: !(use === false || use === "FALSE") }); }
    const byName = {}; schedule().filter(s => s.gender === p.gender || s.gender === "MW").forEach(s => byName[s.name] = s);
    p.planner = {}; p.custom = []; let matched = 0, added = 0;
    for(let r = 9; r < 600; r++){ const b = cellV(pn, "B" + r); const name = cellV(pn, "C" + r); if(b === undefined || b === "" || !name) { if(r > 9) break; else continue; }
      const date = toIso(b); if(!date) break; let s = byName[name]; if(!s){ s = { id: "c" + uid(), name: String(name), start: date, end: "", location: String(cellV(pn, "E" + r) || "TBA"), continent: String(cellV(pn, "D" + r) || "TBA"), size: String(cellV(pn, "F" + r) || "Challenger 6"), restricted: false }; p.custom.push(s); added++; } else matched++;
      const o = {}; const enter = String(cellV(pn, "G" + r) || "No"); if(enter !== "No") o.enter = enter; ["H","I","J"].forEach((col, i) => { const v = cellV(pn, col + r); if(v) o[["exact","rfrom","rto"][i]] = String(v); }); const notes = cellV(pn, "P" + r); if(notes) o.notes = String(notes); const use = cellV(pn, "R" + r); if(use === true || use === "TRUE") o.use = true; if(Object.keys(o).length) p.planner[s.id] = o; }
    if(ps){ for(let r = 5; r <= 18; r++){ const sz = cellV(ps, "A" + r), rd = cellV(ps, "B" + r); if(sz && rd && DATA.points[sz]) p.perf[sz] = String(rd); } const home = cellV(ps, "B23"); if(home && REGIONS.includes(home)) p.home = home;
      for(let r = 28; r <= 34; r++){ const from = cellV(ps, "A" + r); if(REGIONS.includes(from)) p.matrix[from] = "BCDEFGH".split("").map(c => Number(cellV(ps, c + r)) || 3); } }
    const rk = rankingsFor(p.gender); const me = rk && rk.find(x => x.name.toLowerCase() === p.name.toLowerCase()); if(me) p.card = { counting: me.counting, played: me.played, average: me.average, rank: me.rank, date: state.shared.rankingsDate || DATA.rankingsDate };
    savePlayer(p); render(); const t = `Imported ${p.name}: ${p.played.length} results, ${matched} planner rows matched to the schedule, ${added} added as custom rows${me ? ", official card filled from the rankings snapshot" : ""}.`; if(msg) msg.textContent = t; toast("Workbook imported");
  } catch(e){ console.warn(e); if(msg) msg.innerHTML = `<span class="warn">Import failed: ${esc(e.message)}</span>`; else alert("Import failed: " + e.message); }
  const fi = $("#xlsxFile"); if(fi) fi.value = ""; }
function exportPlayer(){ const p = P(); const data = JSON.stringify(p, null, 1); const blob = new Blob([data], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = slug(p.name) + "-planner.json"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast("Exported"); }
function parseCsv(text){ const rows = []; let row = [], cell = "", q = false; for(let i = 0; i < text.length; i++){ const ch = text[i]; if(q){ if(ch === '"'){ if(text[i+1] === '"'){ cell += '"'; i++; } else q = false; } else cell += ch; } else if(ch === '"') q = true; else if(ch === ","){ row.push(cell); cell = ""; } else if(ch === "\n" || ch === "\r"){ if(ch === "\r" && text[i+1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += ch; } if(cell !== "" || row.length){ row.push(cell); rows.push(row); } const head = rows.shift().map(h => h.trim().toLowerCase()); return rows.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()]))); }
async function importScheduleCsv(file){ if(!file) return; const msg = $("#sharedMsg"); if(!ctx.isAdmin){ msg.innerHTML = `<span class="warn">Only an admin can replace the shared schedule.</span>`; $("#schedFile").value = ""; return; } try { const rows = parseCsv(await file.text()); const need = ["start_date","name","level_type","level","gender"]; if(!rows.length || need.some(k => !(k in rows[0]))) throw new Error("Expected the PSA schedule export columns: start_date, end_date, name, city, country, gender, level_type, level, restricted, status.");
    const out = []; rows.forEach(r => { if(!["Satellite","Challenger","World"].includes(r.level_type)) return; const country = (r.country || "").replace(/^[,\s]+/, "").trim(); const size = r.level_type === "Challenger" ? "Challenger " + r.level : (r.level === "World Championships" ? "World Championship" : r.level); if(!DATA.points[size]) return;
      out.push({ id: slug(r.name + "-" + r.gender), name: r.name, start: r.start_date, end: r.end_date || "", location: [r.city, country].filter(Boolean).join(", ") || "TBA", continent: DATA.countryContinent[country] || "TBA", size, gender: r.gender, restricted: !!r.restricted, status: r.status || "" }); });
    state.shared.schedule = out; state.shared.scheduleDate = iso(todayN()); await saveSharedKey("schedule"); render(); msg.textContent = `Schedule replaced: ${out.length} World Tour draws. Planner rows keep their settings where the tournament name and gender match.`; } catch(e){ msg.innerHTML = `<span class="warn">${esc(e.message)}</span>`; } $("#schedFile").value = ""; }
async function importRankingsCsv(file){ if(!file) return; const msg = $("#sharedMsg"); if(!ctx.isAdmin){ msg.innerHTML = `<span class="warn">Only an admin can replace the shared rankings.</span>`; $("#rankFile").value = ""; return; } try { const rows = parseCsv(await file.text()); if(!rows.length || !("rank" in rows[0]) || !("average" in rows[0])) throw new Error("Expected columns: rank, name, country, code, total, counting, average, played.");
    const out = rows.map(r => ({ rank: Number(r.rank), name: r.name, country: r.country || "", code: r.code || "", total: Number(r.total) || 0, counting: Number(r.counting) || 0, average: Number(r.average) || 0, played: Number(r.played) || 0 })).filter(r => r.rank);
    const tour = P().gender === "W" ? "rankingsW" : "rankings"; state.shared[tour] = out; state.shared[tour + "Date"] = iso(todayN()); await saveSharedKey(tour); render(); msg.textContent = `${tour === "rankingsW" ? "Women's" : "Men's"} rankings replaced: ${out.length} rows (applied to the ${P().gender === "W" ? "women's" : "men's"} tour because that is the active player's tour).`; } catch(e){ msg.innerHTML = `<span class="warn">${esc(e.message)}</span>`; } $("#rankFile").value = ""; }

/* ---------- mount ---------- */
export async function mountPlanner(context){
  ctx = context; bind();
  $("#whoami").textContent = ctx.user.email + (ctx.isAdmin ? " · admin" : "");
  document.querySelectorAll(".admin-only").forEach(el => { el.hidden = !ctx.isAdmin; });
  try { await loadAll(); setSaveState("Synced"); } catch(e){ console.warn(e); setSaveState("Could not load: " + e.message); }
  render();
}
