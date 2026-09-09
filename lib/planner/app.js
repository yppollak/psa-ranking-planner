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
function normalize(p){ p.planner = p.planner || {}; p.playedIncl = p.playedIncl || {}; p.custom = p.custom || []; p.played = p.played || []; p.card = p.card || {}; p.perf = p.perf || autoPerf(0); p.matrix = p.matrix || JSON.parse(JSON.stringify(DEFAULT_MATRIX)); return p; }
const P = () => state.players[state.active];

/* ---------- derived data ---------- */
const schedule = () => state.shared.schedule || DATA.schedule;
const rankingsFor = g => g === "W" ? (state.shared.rankingsW || null) : (state.shared.rankings || DATA.rankings);
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
function render(){ const p = P(); document.body.classList.toggle("no-player", !p); if(!p){ renderPlayerSel(); return; } renderPlayerSel(); renderStrip(); ({ planner: renderPlanner, played: renderPlayed, calendar: renderCalendar, settings: renderSettings, points: renderPoints, rankings: renderRankings })[state.tab](); }
function renderPlayerSel(){ const sel = $("#playerSel"); sel.hidden = Object.keys(state.players).length < 2; sel.innerHTML = Object.values(state.players).sort((a,b) => a.name.localeCompare(b.name)).map(p => `<option value="${esc(p.id)}"${p.id === state.active ? " selected" : ""}>${esc(p.name)}</option>`).join(""); }
function renderStrip(){ const p = P(); const usePlanner = state.tab === "planner"; const s = usePlanner ? plannerScenario(p) : playedScenario(p); const c = p.card || {};
  const delta = (v, ref, inv) => { if(ref == null || ref === "" || v == null) return ""; const d = v - Number(ref); if(Math.abs(d) < 0.005) return `<span class="delta">= card</span>`; const up = inv ? d < 0 : d > 0; return `<span class="delta ${up ? "up" : "down"}">${d > 0 ? "+" : ""}${fmtN(d)} vs card</span>`; };
  $("#strip").innerHTML = `
    <div class="tile"><span class="eyebrow">Counting points</span><span class="v num">${fmtN(s.total)}</span>${delta(s.total, c.counting)}</div>
    <div class="tile"><span class="eyebrow">Played (in window)</span><span class="v num">${s.played}</span>${delta(s.played, c.played)}</div>
    <div class="tile"><span class="eyebrow">Divisor</span><span class="v num">${s.divisor}</span><span class="d">${s.played <= 15 ? "11 until 16 played" : "played − 4"}</span></div>
    <div class="tile"><span class="eyebrow">Average</span><span class="v num">${fmtN(s.avg)}</span>${delta(s.avg, c.average)}</div>
    <div class="tile rank"><span class="eyebrow">Projected rank</span><span class="v num">${s.rank == null ? "—" : "#" + s.rank}</span>${delta(s.rank, c.rank, true)}</div>
    <div class="tile"><span class="eyebrow">Window</span><span class="v num" style="font-size:18px;padding-top:6px">${fmtD(s.start)} → ${fmtD(s.end)}</span><span class="d">rolls with the latest ticked event</span></div>`;
  const f = floorInfo(p);
  $("#stripNote").textContent = (usePlanner ? "Planner projection: all played results plus every ticked Planner row. " : "Played scenario: only ticked rows count, inside the rolling 365-day window. ") + (f.active ? `Sensible floor: ${f.size} (a win there beats the current average of ${fmtN(f.avg)}).` : `Fewer than 11 counted tournaments — the average is diluted by zeros, so no floor is applied.`); }

function selOpts(list, cur, blank){ return (blank ? `<option value="">${blank}</option>` : "") + list.map(v => `<option${v === cur ? " selected" : ""}>${esc(v)}</option>`).join(""); }
function renderPlanner(){ const p = P(), f = state.filters, today = todayN(), fl = floorInfo(p);
  const cont = $("#fCont"); if(cont.options.length === 1) cont.innerHTML += REGIONS.concat("TBA").map(r => `<option>${r}</option>`).join("");
  const sz = $("#fSize"); if(sz.options.length === 1) sz.innerHTML += SIZES.map(r => `<option>${r}</option>`).join("");
  let rows = pool(p); const q = f.q.trim().toLowerCase();
  rows = rows.filter(r => (f.past || r.d >= today || r.use || r.enter !== "No") && (f.restricted || !r.restricted || r.enter !== "No" || r.use) && (!f.cont || r.continent === f.cont) && (!f.size || r.size === f.size) && (!f.enter || r.enter === f.enter) && (!q || (r.name + " " + r.location).toLowerCase().includes(q)) && (!(f.floor && fl.active) || r.use || r.enter !== "No" || DATA.points[r.size][0] >= fl.avg));
  $("#pCount").textContent = `${rows.length} tournaments`;
  const tb = $("#plannerTbl tbody"); tb.innerHTML = rows.map(r => { const below = fl.active && DATA.points[r.size][0] < fl.avg; const ent = r.d < today ? ` <small>${r.status === "custom" ? "added manually" : r.status}</small>` : (r.status && r.status !== "Upcoming" && r.status !== "custom" ? ` <small>${esc(r.status)}${r.restricted ? " · restricted draw" : ""}</small>` : (r.restricted ? " <small>restricted draw</small>" : ""));
    return `<tr data-id="${esc(r.id)}" class="${r.use ? "used" : ""}${below ? " below" : ""}${r.enter === "No" ? " noenter" : ""}">
      <td><input type="checkbox" data-k="use" ${r.use ? "checked" : ""} aria-label="Use ${esc(r.name)}"></td>
      <td class="num" style="white-space:nowrap">${fmtD(r.d)}</td>
      <td class="tname">${esc(r.name)}${ent}</td>
      <td><span class="tier tier-${r.tier}">${esc(r.continent)}${r.tier ? " · " + r.tier : ""}</span></td>
      <td class="loc">${esc(r.location)}</td>
      <td>${r.fromSchedule ? esc(r.size) : `<select data-k="size">${selOpts(SIZES, r.size)}</select>`}</td>
      <td><select data-k="enter">${selOpts(["Yes","No","Planned"], r.enter)}</select></td>
      <td><select data-k="exact">${selOpts(ROUNDS, r.exact, "—")}</select></td>
      <td><select data-k="rfrom">${selOpts(ROUNDS, r.rfrom, "—")}</select></td>
      <td><select data-k="rto">${selOpts(ROUNDS, r.rto, "—")}</select></td>
      <td class="r num"><b>${fmtN(r.pts)}</b></td>
      <td><input type="text" class="notes-in" data-k="notes" value="${esc(r.notes)}" placeholder="…"></td>
      <td>${r.fromSchedule ? "" : `<button class="del" data-del="1" title="Remove">×</button>`}</td></tr>`; }).join("");
  $("#plannerLegend").innerHTML = `<span>Travel difficulty from <b>${esc(p.home)}</b>:</span>` + [1,2,3,4,5].map(t => `<span><i class="sw tier-${t}" style="background:var(--t${t})"></i>${["","1 — easiest","2 — near","3 — medium","4 — far","5 — hardest"][t]}</span>`).join("") + `<span><i class="sw" style="background:var(--surface-2)"></i>TBA</span><span style="margin-left:auto">Points precedence: exact result › range average › expected round from Settings.</span>`; }

function renderPlayed(){ const p = P(), s = playedScenario(p), today = todayN();
  const kv = (pairs) => pairs.map(([k,v]) => `<b class="num">${v}</b><span>${k}</span>`).join("");
  $("#playedMain").innerHTML = kv([["counting points", fmtN(s.total)], ["played in window", s.played], ["divisor", s.divisor], ["average", fmtN(s.avg)], ["rank", s.rank == null ? "—" : "#" + s.rank]]);
  $("#windowMsg").textContent = `Window ${fmtD(s.start)} → ${fmtD(s.end)}. A result expires 364 days after the tournament's start date.`;
  $("#playedChecked").innerHTML = kv([["points", fmtN(s.checkedPts)], ["tournaments", s.checkedN]]);
  $("#playedCount").textContent = `${p.played.length} results · ${s.rows.length - p.played.length} pulled from the Planner`;
  let out = "", seenToday = false, seenYear = false;
  s.rows.forEach(r => { if(!seenToday && r.d != null && r.d > today){ seenToday = true; out += `<tr class="divider today"><td colspan="15">▲ today ▲</td></tr>`; } if(!seenYear && r.d != null && r.d > today + 365){ seenYear = true; out += `<tr class="divider year"><td colspan="15">▲ 1 year mark ▲</td></tr>`; }
    const manual = r.kind === "manual"; const cls = (manual ? "" : "auto") + (r.incl && !r.inwin ? " expired" : "");
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
  const fl = floorInfo(p); $("#floorMsg").textContent = fl.active ? `Current average ${fmtN(fl.avg)} → floor ${fl.size}.` : `Average ${fmtN(fl.avg)} on ${fl.played} played — no floor until 11 tournaments.`;
  $("#matrixTbl").innerHTML = `<thead><tr><th>From \\ To</th>${REGIONS.map(r => `<th>${esc(r.replace(" America"," Am."))}</th>`).join("")}</tr></thead><tbody>` + REGIONS.map(from => `<tr${from === p.home ? ' style="background:var(--surface-2)"' : ""}><td class="hd">${esc(from)}${from === p.home ? " ★" : ""}</td>${REGIONS.map((to, j) => `<td><input type="number" min="1" max="5" data-mf="${esc(from)}" data-mj="${j}" value="${p.matrix[from][j]}"></td>`).join("")}</tr>`).join("") + `</tbody>`;  loadIngestPanel(); }

function renderPoints(){ $("#pointsTbl").innerHTML = `<thead><tr><th>Category</th>${ROUNDS.map(r => `<th class="r">${esc(r)}</th>`).join("")}</tr></thead><tbody>` + SIZES.map(sz => `<tr><td class="hd" style="font-weight:500">${esc(sz)}</td>${DATA.points[sz].map(v => `<td class="r num">${v == null ? `<span class="na">—</span>` : fmtN(v)}</td>`).join("")}</tr>`).join("") + "</tbody>"; }

function renderRankings(){ const p = P(); const rk = rankingsFor(p.gender); const s = playedScenario(p);
  if(!rk){ $("#rankIntro").textContent = "No women's rankings snapshot loaded yet. Import one under Settings → Replace rankings (CSV) with columns rank, name, country, code, total, counting, average, played."; $("#rankTbl tbody").innerHTML = ""; $("#rCount").textContent = ""; return; }
  $("#rankIntro").textContent = `${p.gender === "W" ? "Women's" : "Men's"} PSA World Rankings snapshot (${state.shared.rankingsDate || DATA.rankingsDate}). Ranks 1–200 exact; beyond that sampled anchors — the rank↔average curve is stable between refreshes. Used to turn a projected average into a position.`;
  const q = state.rq.trim().toLowerCase(); const you = { rank: s.rank, name: `${p.name} — projected (Played tab)`, country: "", total: "", counting: s.total, average: s.avg, played: s.played, you: true };
  let rows = rk.filter(r => !q || (r.name + " " + r.country).toLowerCase().includes(q)); if(!q && s.rank != null){ const i = rows.findIndex(r => r.rank >= s.rank); rows = rows.slice(); rows.splice(i < 0 ? rows.length : i, 0, you); }
  $("#rCount").textContent = `${rk.length} players`;
  $("#rankTbl tbody").innerHTML = rows.map(r => `<tr${r.you ? ' style="background:var(--yes-soft);font-weight:600"' : ""}><td class="r num">${r.you ? "→ #" + r.rank : r.rank}</td><td>${esc(r.name)}</td><td>${esc(r.country)}${r.code ? ` <span class="na">${esc(r.code)}</span>` : ""}</td><td class="r num">${r.total === "" ? "" : fmtN(r.total)}</td><td class="r num">${fmtN(r.counting)}</td><td class="r num">${fmtN(r.average)}</td><td class="r num">${r.played}</td></tr>`).join(""); }

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
    el.innerHTML = `<b class="num">${tourneys}</b><span>tournaments</span><b class="num">${data.length}</b><span>draws</span>`
      + `<b class="num" style="font-size:15px">${last ? new Date(last).toLocaleString() : "—"}</b><span>last capture</span>`;
    msg.textContent = data.length ? "" : "Nothing captured yet. Install the extension, paste the token above, and press Refresh now.";
  } catch(e){ el.innerHTML = ""; msg.innerHTML = `<span class="warn">Could not read entry lists: ${esc(e.message)}</span>`; }
}

/* ---------- events ---------- */
function bind(){
  $("#tabs").addEventListener("click", e => { const b = e.target.closest(".tab"); if(!b) return; state.tab = b.dataset.tab; document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", t === b)); document.querySelectorAll(".panel").forEach(pn => pn.classList.toggle("active", pn.id === "panel-" + state.tab)); render(); });
  $("#playerSel").addEventListener("change", e => { state.active = e.target.value; rememberActive(); render(); });
  $("#emptyNewBtn").addEventListener("click", newPlayerModal);
  $("#newPlayerBtn").addEventListener("click", newPlayerModal);
  // planner filters
  $("#pSearch").addEventListener("input", e => { state.filters.q = e.target.value; renderPlanner(); });
  [["fCont","cont"],["fSize","size"],["fEnter","enter"]].forEach(([id,k]) => $("#"+id).addEventListener("change", e => { state.filters[k] = e.target.value; renderPlanner(); }));
  [["fFloor","floor"],["fPast","past"],["fRestricted","restricted"]].forEach(([id,k]) => $("#"+id).addEventListener("change", e => { state.filters[k] = e.target.checked; renderPlanner(); }));
  $("#addCustomBtn").addEventListener("click", customModal);
  $("#plannerTbl").addEventListener("change", e => { const tr = e.target.closest("tr"); if(!tr) return; const p = P(), id = tr.dataset.id, k = e.target.dataset.k; if(!k) return;
    const custom = p.custom.find(c => c.id === id); if(k === "size" && custom){ custom.size = e.target.value; } else { const o = p.planner[id] = p.planner[id] || {}; o[k] = e.target.type === "checkbox" ? e.target.checked : e.target.value; if(k === "enter" && o.enter === "No") delete o.enter; if(!o[k] && k !== "use") delete o[k]; if(!Object.keys(o).length) delete p.planner[id]; }
    savePlayer(p); renderStrip(); if(k === "use" || k === "enter" || k === "size") renderPlanner(); else { const row = pool(p).find(r => r.id === id); tr.querySelector("td.r b").textContent = fmtN(row.pts); } });
  $("#plannerTbl").addEventListener("click", e => { if(!e.target.dataset.del) return; const p = P(), id = e.target.closest("tr").dataset.id; p.custom = p.custom.filter(c => c.id !== id); delete p.planner[id]; delete p.playedIncl[id]; savePlayer(p); render(); });
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
function modal(html){ const root = $("#modalRoot"); root.innerHTML = `<div class="modal-bg"><div class="modal" role="dialog">${html}</div></div>`; root.querySelector(".modal-bg").addEventListener("click", e => { if(e.target.classList.contains("modal-bg")) root.innerHTML = ""; }); return root; }
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
