// ===== GymAmigo app =====
"use strict";

const $ = (id) => document.getElementById(id);
const STORE_KEY = "gymamigo_v1";

// ---------- State ----------
let S = load();
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* corrupt data → fresh start */ }
  return { profile: null, goal: "spieropbouw", sessions: [], foodLog: {}, weights: [], customFoods: [], recentFoods: [], schema: null };
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }

// ---------- Helpers ----------
const DAYS = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const DAYS_SHORT = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];
const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

function todayKey() { return dateKey(new Date()); }
function dateKey(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function fmtDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const t = todayKey();
  if (key === t) return "vandaag";
  const yst = new Date(); yst.setDate(yst.getDate() - 1);
  if (key === dateKey(yst)) return "gisteren";
  return DAYS[dt.getDay()] + " " + d + " " + MONTHS[m - 1];
}
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 2200);
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ---------- Berekeningen ----------
function bmr(p) {
  // Mifflin-St Jeor
  return Math.round(10 * p.weight + 6.25 * p.height - 5 * p.age + (p.gender === "m" ? 5 : -161));
}
function tdee(p) { return Math.round(bmr(p) * p.activity); }

function targets() {
  const p = S.profile;
  if (!p) return { kcal: 2000, protein: 120, carbs: 220, fat: 65 };
  const t = tdee(p);
  let kcal, protPerKg;
  if (S.goal === "afvallen") { kcal = t - 500; protPerKg = 2.0; }
  else if (S.goal === "spieropbouw") { kcal = t + 300; protPerKg = 2.0; }
  else { kcal = t; protPerKg = 1.6; }
  kcal = Math.max(kcal, 1200);
  const protein = Math.round(protPerKg * p.weight);
  const fat = Math.round((kcal * 0.27) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, carbs, fat, tdee: t, bmr: bmr(p) };
}

function exById(id) { return EXERCISES.find((e) => e.id === id); }

// kcal van één oefening binnen een sessie
function exKcal(entry) {
  const ex = exById(entry.exId);
  const w = S.profile ? S.profile.weight : 75;
  if (!ex) return 0;
  if (ex.cardio) {
    const min = entry.minutes || 0;
    return ex.met * w * (min / 60);
  }
  // Kracht: schat ±2,5 min per set (incl. rust)
  const sets = entry.sets.filter((s) => s.reps > 0).length;
  return ex.met * w * ((sets * 2.5) / 60);
}
function exVolume(entry) {
  const ex = exById(entry.exId);
  if (!ex || ex.cardio) return 0;
  return entry.sets.reduce((sum, s) => sum + (s.reps || 0) * (s.weight || 0), 0);
}

function sessionTotals(sess) {
  let kcal = 0, vol = 0, sets = 0;
  for (const e of sess.exercises) {
    kcal += exKcal(e);
    vol += exVolume(e);
    const ex = exById(e.exId);
    if (ex && !ex.cardio) sets += e.sets.filter((s) => s.reps > 0).length;
  }
  return { kcal: Math.round(kcal), vol: Math.round(vol), sets };
}

// Streak: aantal opeenvolgende dagen (eindigend vandaag of gisteren) met een sessie
function streak() {
  const days = new Set(S.sessions.map((s) => s.date));
  let count = 0;
  const d = new Date();
  if (!days.has(dateKey(d))) d.setDate(d.getDate() - 1); // vandaag nog niet getraind? tel vanaf gisteren
  while (days.has(dateKey(d))) { count++; d.setDate(d.getDate() - 1); }
  return count;
}

// ---------- Tabs ----------
document.querySelectorAll("#tabbar button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#tabbar button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab").forEach((t) => t.classList.add("hidden"));
    $("tab-" + btn.dataset.tab).classList.remove("hidden");
    render();
  });
});

// ---------- Onboarding ----------
function bindSeg(el) {
  el.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      el.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
    });
  });
}
bindSeg($("ob-gender"));
bindSeg($("ob-goal"));

$("ob-save").addEventListener("click", () => {
  const name = $("ob-name").value.trim();
  const age = +$("ob-age").value, weight = +$("ob-weight").value, height = +$("ob-height").value;
  if (!name || !age || !weight || !height) { toast("Vul alle velden in 🙂"); return; }
  S.profile = {
    name, age, weight, height,
    gender: $("ob-gender").querySelector(".active").dataset.v,
    activity: +$("ob-activity").value,
  };
  S.goal = $("ob-goal").querySelector(".active").dataset.v;
  if (!S.weights.length) S.weights.push({ date: todayKey(), kg: weight });
  save();
  $("onboarding").classList.add("hidden");
  render();
  toast("Welkom bij GymAmigo, " + name + "! 💪");
});

function openProfileEditor() {
  const p = S.profile;
  $("ob-name").value = p.name; $("ob-age").value = p.age; $("ob-weight").value = p.weight;
  $("ob-height").value = p.height; $("ob-activity").value = String(p.activity);
  $("ob-gender").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.v === p.gender));
  $("ob-goal").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.v === S.goal));
  $("onboarding").classList.remove("hidden");
}
$("btn-edit-profile").addEventListener("click", openProfileEditor);

// ---------- GYM: weekoverzicht ----------
function renderWeek() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const trainedDays = new Set(S.sessions.map((s) => s.date));
  let dots = "";
  let weekSessions = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const k = dateKey(d);
    const done = trainedDays.has(k);
    const isToday = k === todayKey();
    if (done) weekSessions.push(...S.sessions.filter((s) => s.date === k));
    dots += `<div class="wd ${done ? "done" : ""} ${isToday ? "today" : ""}"><div class="dot">${done ? "✓" : ""}</div>${DAYS_SHORT[i]}</div>`;
  }
  $("week-dots").innerHTML = dots;
  let kcal = 0, vol = 0;
  for (const s of weekSessions) { const t = sessionTotals(s); kcal += t.kcal; vol += t.vol; }
  const uniqueDays = new Set(weekSessions.map((s) => s.date)).size;
  $("week-stats").innerHTML =
    `<div class="ws"><b>${uniqueDays}</b><span>trainingen</span></div>` +
    `<div class="ws"><b>${kcal}</b><span>kcal verbrand</span></div>` +
    `<div class="ws"><b>${vol >= 1000 ? (vol / 1000).toFixed(1) + "t" : vol + " kg"}</b><span>volume getild</span></div>`;
}

// ---------- GYM: sessie-builder ----------
let draft = null; // { date, exercises: [{exId, sets:[{reps,weight}], minutes}] }

$("btn-new-session").addEventListener("click", () => {
  draft = { date: todayKey(), exercises: [] };
  openSession();
});

function openSession() {
  $("sheet-session").classList.remove("hidden");
  renderDraft();
}
$("sess-cancel").addEventListener("click", () => {
  $("sheet-session").classList.add("hidden");
  draft = null;
});
$("sess-add-ex").addEventListener("click", () => openExPicker());

$("sess-save").addEventListener("click", () => {
  if (!draft || !draft.exercises.length) { toast("Voeg eerst een oefening toe"); return; }
  // lege sets eruit filteren
  draft.exercises.forEach((e) => { if (e.sets) e.sets = e.sets.filter((s) => s.reps > 0); });
  draft.exercises = draft.exercises.filter((e) => {
    const ex = exById(e.exId);
    return ex && (ex.cardio ? e.minutes > 0 : e.sets.length > 0);
  });
  if (!draft.exercises.length) { toast("Vul herhalingen of minuten in"); return; }
  draft.id = Date.now();
  S.sessions.push(draft);
  S.sessions.sort((a, b) => (a.date < b.date ? 1 : -1));
  save();
  const t = sessionTotals(draft);
  $("sheet-session").classList.add("hidden");
  draft = null;
  render();
  toast(`Sessie opgeslagen! 🔥 ${t.kcal} kcal · ${t.vol} kg volume`);
});

function renderDraft() {
  const wrap = $("sess-exercises");
  if (!draft.exercises.length) {
    wrap.innerHTML = `<div class="empty">Nog geen oefeningen.<br>Tik op "＋ Oefening toevoegen".</div>`;
  } else {
    wrap.innerHTML = draft.exercises.map((e, i) => {
      const ex = exById(e.exId);
      if (ex.cardio) {
        return `<div class="sx">
          <div class="sx-head"><div class="sx-name">${esc(ex.name)}</div>
            <button class="link-btn danger" data-delex="${i}">✕</button></div>
          <div class="set-row" style="grid-template-columns: 1fr 2fr;">
            <span class="set-n" style="text-align:left">Minuten</span>
            <input type="number" inputmode="numeric" placeholder="min" value="${e.minutes || ""}" data-min="${i}">
          </div></div>`;
      }
      const rows = e.sets.map((s, j) => `
        <div class="set-row">
          <span class="set-n">${j + 1}</span>
          <input type="number" inputmode="numeric" placeholder="herh." value="${s.reps || ""}" data-reps="${i}:${j}">
          <input type="number" inputmode="decimal" placeholder="kg" value="${s.weight || ""}" data-weight="${i}:${j}">
          <button class="del-set" data-delset="${i}:${j}">✕</button>
        </div>`).join("");
      return `<div class="sx">
        <div class="sx-head"><div class="sx-name">${esc(ex.name)}</div>
          <button class="link-btn danger" data-delex="${i}">✕</button></div>
        <div class="sx-sets">
          <div class="set-row"><span class="set-n">#</span><span class="set-n">herh.</span><span class="set-n">kg</span><span></span></div>
          ${rows}
        </div>
        <button class="add-set" data-addset="${i}">＋ Set toevoegen</button>
      </div>`;
    }).join("");
  }
  renderLive();

  wrap.querySelectorAll("[data-delex]").forEach((b) => b.addEventListener("click", () => {
    draft.exercises.splice(+b.dataset.delex, 1); renderDraft();
  }));
  wrap.querySelectorAll("[data-addset]").forEach((b) => b.addEventListener("click", () => {
    const e = draft.exercises[+b.dataset.addset];
    const last = e.sets[e.sets.length - 1];
    e.sets.push({ reps: last ? last.reps : 0, weight: last ? last.weight : 0 });
    renderDraft();
  }));
  wrap.querySelectorAll("[data-delset]").forEach((b) => b.addEventListener("click", () => {
    const [i, j] = b.dataset.delset.split(":").map(Number);
    draft.exercises[i].sets.splice(j, 1); renderDraft();
  }));
  wrap.querySelectorAll("[data-reps]").forEach((inp) => inp.addEventListener("input", () => {
    const [i, j] = inp.dataset.reps.split(":").map(Number);
    draft.exercises[i].sets[j].reps = +inp.value || 0; renderLive();
  }));
  wrap.querySelectorAll("[data-weight]").forEach((inp) => inp.addEventListener("input", () => {
    const [i, j] = inp.dataset.weight.split(":").map(Number);
    draft.exercises[i].sets[j].weight = +inp.value || 0; renderLive();
  }));
  wrap.querySelectorAll("[data-min]").forEach((inp) => inp.addEventListener("input", () => {
    draft.exercises[+inp.dataset.min].minutes = +inp.value || 0; renderLive();
  }));
}

function renderLive() {
  const t = sessionTotals(draft);
  $("sess-live").innerHTML =
    `<div><b>${t.kcal}</b>kcal</div><div><b>${t.vol}</b>kg volume</div><div><b>${t.sets}</b>sets</div>`;
}

// ---------- Oefening-picker ----------
let expickFilter = "Alles";
function openExPicker() {
  $("sheet-expick").classList.remove("hidden");
  $("expick-search").value = "";
  $("expick-chips").innerHTML = MUSCLE_GROUPS.map((m) =>
    `<button class="chip ${m === expickFilter ? "active" : ""}" data-m="${m}">${m}</button>`).join("");
  $("expick-chips").querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => {
    expickFilter = c.dataset.m; openExPicker();
  }));
  renderExList();
}
$("expick-close").addEventListener("click", () => $("sheet-expick").classList.add("hidden"));
$("expick-search").addEventListener("input", renderExList);

function renderExList() {
  const q = $("expick-search").value.toLowerCase();
  const list = EXERCISES.filter((e) =>
    (expickFilter === "Alles" || e.muscle === expickFilter) &&
    (!q || e.name.toLowerCase().includes(q) || e.muscle.toLowerCase().includes(q)));
  $("expick-list").innerHTML = list.map((e) =>
    `<div class="pick-item" data-ex="${e.id}">
      <div><div class="pi-name">${esc(e.name)}</div><div class="pi-sub">${e.muscle}${e.cardio ? " · minuten" : ""}</div></div>
      <div class="pi-right">＋</div></div>`).join("") || `<div class="empty">Geen oefeningen gevonden</div>`;
  $("expick-list").querySelectorAll(".pick-item").forEach((el) => el.addEventListener("click", () => {
    const ex = exById(el.dataset.ex);
    draft.exercises.push(ex.cardio
      ? { exId: ex.id, minutes: 0, sets: [] }
      : { exId: ex.id, sets: [{ reps: 0, weight: 0 }, { reps: 0, weight: 0 }, { reps: 0, weight: 0 }] });
    $("sheet-expick").classList.add("hidden");
    renderDraft();
  }));
}

// ---------- Geschiedenis ----------
function renderHistory() {
  const wrap = $("session-history");
  if (!S.sessions.length) {
    wrap.innerHTML = `<div class="empty">Nog geen sessies. Tijd om te trainen! 💪</div>`;
    return;
  }
  wrap.innerHTML = S.sessions.slice(0, 30).map((s) => {
    const t = sessionTotals(s);
    const detail = s.exercises.map((e) => {
      const ex = exById(e.exId);
      if (!ex) return "";
      if (ex.cardio) return `<div class="ex-line"><b>${esc(ex.name)}</b><span>${e.minutes} min</span></div>`;
      const best = e.sets.reduce((m, x) => Math.max(m, x.weight || 0), 0);
      return `<div class="ex-line"><b>${esc(ex.name)}</b><span>${e.sets.length}×${e.sets[0]?.reps || 0}${best ? " · " + best + " kg" : ""}</span></div>`;
    }).join("");
    return `<div class="sess-item" data-id="${s.id}">
      <div class="sess-top"><div class="sess-date">${fmtDate(s.date)}</div>
        <button class="link-btn danger" data-del="${s.id}">✕</button></div>
      <div class="sess-badges">
        <span class="badge hl">🔥 ${t.kcal} kcal</span>
        <span class="badge">🏋️ ${t.vol} kg</span>
        <span class="badge">${s.exercises.length} oef.</span>
      </div>
      <div class="sess-detail" style="display:none">${detail}</div>
    </div>`;
  }).join("");

  wrap.querySelectorAll(".sess-item").forEach((el) => el.addEventListener("click", (ev) => {
    if (ev.target.dataset.del) return;
    const d = el.querySelector(".sess-detail");
    d.style.display = d.style.display === "none" ? "block" : "none";
  }));
  wrap.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
    confirmModal("Sessie verwijderen?", () => {
      S.sessions = S.sessions.filter((x) => x.id !== +b.dataset.del);
      save(); render();
    });
  }));
}

// ---------- Schema-generator ----------
function pickEx(muscle, n, exclude) {
  const pool = EXERCISES.filter((e) => e.muscle === muscle && !e.cardio && !exclude.has(e.id));
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    const idx = (S.profile ? S.profile.name.length + i * 3 : i) % pool.length; // deterministisch maar gevarieerd
    const chosen = pool.splice((idx + Math.floor(Math.random() * pool.length)) % pool.length, 1)[0];
    exclude.add(chosen.id);
    out.push(chosen);
  }
  return out;
}

function generateSchema() {
  const goal = S.goal;
  const days = goal === "spieropbouw" ? 4 : 3;
  const scheme = goal === "spieropbouw" ? "4 sets · 8-12 herh." : goal === "afvallen" ? "3 sets · 12-15 herh." : "3 sets · 8-12 herh.";
  const schema = [];
  const used = new Set();

  if (days >= 4) {
    // Upper / Lower split ×2
    const mk = (title, groups) => ({
      title, scheme,
      exercises: groups.flatMap(([m, n]) => pickEx(m, n, used)).map((e) => ({ id: e.id, name: e.name })),
    });
    schema.push(mk("Dag 1 · Upper (borst/rug)", [["Borst", 2], ["Rug", 2], ["Schouders", 1], ["Triceps", 1]]));
    schema.push(mk("Dag 2 · Lower (benen/core)", [["Benen", 4], ["Core", 2]]));
    used.clear();
    schema.push(mk("Dag 3 · Upper (schouders/armen)", [["Schouders", 2], ["Rug", 2], ["Biceps", 1], ["Borst", 1]]));
    schema.push(mk("Dag 4 · Lower (benen/core)", [["Benen", 4], ["Core", 2]]));
  } else {
    for (let d = 1; d <= days; d++) {
      const exs = [
        ...pickEx("Benen", 2, used), ...pickEx("Borst", 1, used), ...pickEx("Rug", 1, used),
        ...pickEx("Schouders", 1, used), ...pickEx("Core", 1, used),
      ];
      schema.push({ title: `Dag ${d} · Full body`, scheme, exercises: exs.map((e) => ({ id: e.id, name: e.name })) });
      if (used.size > EXERCISES.length - 12) used.clear();
    }
  }
  if (goal === "afvallen") {
    schema.forEach((day) => day.exercises.push({ id: "hiit", name: "HIIT-training (15-20 min)" }));
  }
  S.schema = schema;
  save();
}

$("btn-schema").addEventListener("click", () => {
  if (!S.schema) generateSchema();
  const card = $("schema-card");
  card.style.display = card.style.display === "none" ? "block" : "none";
  renderSchema();
});
$("btn-regen-schema").addEventListener("click", () => { generateSchema(); renderSchema(); toast("Nieuw schema gemaakt! 📋"); });

function renderSchema() {
  if (!S.schema) return;
  $("schema-days").innerHTML = S.schema.map((day, i) => `
    <div class="schema-day">
      <div class="schema-day-head">${esc(day.title)}
        <button class="link-btn" data-start="${i}">Start ▸</button></div>
      <div class="pi-sub" style="margin:2px 0 6px">${day.scheme}</div>
      ${day.exercises.map((e) => `<div class="schema-ex"><span>${esc(e.name)}</span></div>`).join("")}
    </div>`).join("");
  $("schema-days").querySelectorAll("[data-start]").forEach((b) => b.addEventListener("click", () => {
    const day = S.schema[+b.dataset.start];
    draft = {
      date: todayKey(),
      exercises: day.exercises.filter((e) => exById(e.id)).map((e) => {
        const ex = exById(e.id);
        return ex.cardio
          ? { exId: e.id, minutes: 0, sets: [] }
          : { exId: e.id, sets: [{ reps: 0, weight: 0 }, { reps: 0, weight: 0 }, { reps: 0, weight: 0 }] };
      }),
    };
    openSession();
  }));
}

// ---------- FOOD ----------
let foodDate = todayKey();

$("food-prev").addEventListener("click", () => shiftFoodDate(-1));
$("food-next").addEventListener("click", () => shiftFoodDate(1));
function shiftFoodDate(n) {
  const [y, m, d] = foodDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + n);
  if (dateKey(dt) > todayKey()) return;
  foodDate = dateKey(dt);
  renderFood();
}

function dayFood() { return S.foodLog[foodDate] || []; }

function renderFood() {
  $("food-date").textContent = fmtDate(foodDate);
  $("food-day-label").textContent = foodDate === todayKey() ? "vandaag" : fmtDate(foodDate);
  const T = targets();
  const items = dayFood();
  const sum = items.reduce((a, f) => ({ kcal: a.kcal + f.kcal, p: a.p + f.p, c: a.c + f.c, f: a.f + f.f }),
    { kcal: 0, p: 0, c: 0, f: 0 });

  $("kcal-eaten").textContent = Math.round(sum.kcal);
  $("kcal-target").textContent = T.kcal;
  const circ = 2 * Math.PI * 52;
  const frac = Math.min(sum.kcal / T.kcal, 1);
  const rv = $("kcal-ring-val");
  rv.style.strokeDashoffset = circ * (1 - frac);
  rv.classList.toggle("over", sum.kcal > T.kcal);

  const setBar = (bar, txt, val, max, unit) => {
    $(bar).style.width = Math.min((val / max) * 100, 100) + "%";
    $(txt).textContent = `${Math.round(val)} / ${max} ${unit}`;
  };
  setBar("prot-bar", "prot-txt", sum.p, T.protein, "g");
  setBar("carb-bar", "carb-txt", sum.c, T.carbs, "g");
  setBar("fat-bar", "fat-txt", sum.f, T.fat, "g");

  $("food-list").innerHTML = items.length ? items.map((f, i) => `
    <div class="food-item">
      <div><div class="fi-name">${esc(f.name)}</div>
        <div class="fi-sub">${f.grams} g · E ${Math.round(f.p)} · K ${Math.round(f.c)} · V ${Math.round(f.f)}</div></div>
      <div style="display:flex;align-items:center">
        <span class="fi-kcal">${Math.round(f.kcal)} kcal</span>
        <button class="del" data-i="${i}">✕</button>
      </div></div>`).join("")
    : `<div class="empty">Nog niets gelogd ${foodDate === todayKey() ? "vandaag" : "op deze dag"} 🍽️</div>`;
  $("food-list").querySelectorAll(".del").forEach((b) => b.addEventListener("click", () => {
    S.foodLog[foodDate].splice(+b.dataset.i, 1);
    save(); renderFood();
  }));
}

// ---------- Food picker ----------
$("btn-add-food").addEventListener("click", () => {
  $("sheet-foodpick").classList.remove("hidden");
  $("foodpick-search").value = "";
  renderFoodList();
});
$("foodpick-close").addEventListener("click", () => $("sheet-foodpick").classList.add("hidden"));
$("foodpick-search").addEventListener("input", renderFoodList);

function allFoods() { return [...S.customFoods, ...FOODS]; }

function renderFoodList() {
  const q = $("foodpick-search").value.toLowerCase();
  // Recent
  const recentWrap = $("foodpick-recent");
  if (!q && S.recentFoods.length) {
    recentWrap.innerHTML = `<div class="section-title" style="margin-top:0">Recent</div>` +
      S.recentFoods.slice(0, 5).map((name, i) => {
        const f = allFoods().find((x) => x.name === name);
        return f ? foodRow(f, "r" + i) : "";
      }).join("");
  } else recentWrap.innerHTML = "";

  const list = allFoods().filter((f) => !q || f.name.toLowerCase().includes(q));
  $("foodpick-list").innerHTML = (q ? "" : `<div class="section-title">Alle producten</div>`) +
    (list.slice(0, 60).map((f, i) => foodRow(f, i)).join("") || `<div class="empty">Niets gevonden — voeg een eigen product toe!</div>`);

  document.querySelectorAll("[data-food]").forEach((el) => el.addEventListener("click", () => {
    const f = allFoods().find((x) => x.name === el.dataset.food);
    if (f) openGramsModal(f);
  }));
}
function foodRow(f, key) {
  return `<div class="pick-item" data-food="${esc(f.name)}" data-k="${key}">
    <div><div class="pi-name">${esc(f.name)}</div>
      <div class="pi-sub">${f.kcal} kcal · ${f.p} g eiwit (per 100 g)</div></div>
    <div class="pi-right">＋</div></div>`;
}

function openGramsModal(f) {
  showModal(`
    <h2>${esc(f.name)}</h2>
    <p class="muted small">${f.kcal} kcal · E ${f.p} · K ${f.c} · V ${f.f} per 100 g</p>
    <label>Hoeveel gram?</label>
    <input type="number" inputmode="numeric" id="grams-input" value="100">
    <div class="chip-row" style="margin-top:10px">
      ${[25, 50, 100, 150, 200, 250].map((g) => `<button class="chip" data-g="${g}">${g} g</button>`).join("")}
    </div>
    <div class="row2" style="margin-top:16px;margin-bottom:0">
      <button class="btn-secondary" id="m-cancel">Annuleer</button>
      <button class="btn-primary" id="m-ok">Toevoegen</button>
    </div>`);
  document.querySelectorAll("[data-g]").forEach((c) => c.addEventListener("click", () => {
    $("grams-input").value = c.dataset.g;
  }));
  $("m-cancel").addEventListener("click", closeModal);
  $("m-ok").addEventListener("click", () => {
    const g = +$("grams-input").value || 0;
    if (g <= 0) { toast("Vul gram in"); return; }
    const mult = g / 100;
    if (!S.foodLog[foodDate]) S.foodLog[foodDate] = [];
    S.foodLog[foodDate].push({
      name: f.name, grams: g,
      kcal: f.kcal * mult, p: f.p * mult, c: f.c * mult, f: f.f * mult,
    });
    S.recentFoods = [f.name, ...S.recentFoods.filter((n) => n !== f.name)].slice(0, 10);
    save();
    closeModal();
    $("sheet-foodpick").classList.add("hidden");
    renderFood();
    toast(`${f.name} toegevoegd ✓`);
  });
}

$("btn-custom-food").addEventListener("click", () => {
  showModal(`
    <h2>Eigen product</h2>
    <label>Naam</label><input type="text" id="cf-name" placeholder="Bijv. Proteïne pannenkoek">
    <div class="row2" style="margin-bottom:0">
      <div><label>Kcal / 100 g</label><input type="number" inputmode="decimal" id="cf-kcal"></div>
      <div><label>Eiwit / 100 g</label><input type="number" inputmode="decimal" id="cf-p"></div>
    </div>
    <div class="row2" style="margin-bottom:0">
      <div><label>Koolh. / 100 g</label><input type="number" inputmode="decimal" id="cf-c"></div>
      <div><label>Vet / 100 g</label><input type="number" inputmode="decimal" id="cf-f"></div>
    </div>
    <div class="row2" style="margin-top:16px;margin-bottom:0">
      <button class="btn-secondary" id="m-cancel">Annuleer</button>
      <button class="btn-primary" id="m-ok">Opslaan</button>
    </div>`);
  $("m-cancel").addEventListener("click", closeModal);
  $("m-ok").addEventListener("click", () => {
    const name = $("cf-name").value.trim();
    if (!name || !+$("cf-kcal").value) { toast("Vul naam en kcal in"); return; }
    S.customFoods.unshift({
      name, kcal: +$("cf-kcal").value, p: +$("cf-p").value || 0, c: +$("cf-c").value || 0, f: +$("cf-f").value || 0,
    });
    save(); closeModal(); renderFoodList();
    toast("Product opgeslagen ✓");
  });
});

// ---------- GOALS ----------
$("goal-pick").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
  S.goal = b.dataset.v;
  S.schema = null; // schema opnieuw genereren bij nieuw doel
  save(); render();
  toast("Doel aangepast — je schema en targets zijn bijgewerkt!");
}));

function renderGoals() {
  $("goal-pick").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.v === S.goal));
  const T = targets();
  const goalTxt = {
    afvallen: {
      title: "Plan: afvallen 🔥",
      note: `Je zit <b>500 kcal onder</b> je verbruik (TDEE ${T.tdee} kcal) — goed voor ±0,5 kg vetverlies per week. Eiwit hoog houden beschermt je spiermassa.`,
      train: "3× krachttraining + 2× cardio (20-30 min) per week",
    },
    spieropbouw: {
      title: "Plan: spieropbouw 💪",
      note: `Je zit <b>300 kcal boven</b> je verbruik (TDEE ${T.tdee} kcal) — een 'lean bulk' voor spiergroei met minimale vetopslag.`,
      train: "4× krachttraining per week, focus op zwaarder worden per week",
    },
    onderhoud: {
      title: "Plan: onderhoud ⚖️",
      note: `Je eet gelijk aan je verbruik (TDEE ${T.tdee} kcal) om op gewicht te blijven en fit te blijven.`,
      train: "2-3× krachttraining + regelmatig bewegen",
    },
  }[S.goal];

  $("goal-advice").innerHTML = `
    <div class="card-title">${goalTxt.title}</div>
    <div class="advice-grid">
      <div class="adv"><b>${T.kcal}</b><span>kcal per dag</span></div>
      <div class="adv"><b>${T.protein} g</b><span>eiwit per dag</span></div>
      <div class="adv"><b>${T.carbs} g</b><span>koolhydraten</span></div>
      <div class="adv"><b>${T.fat} g</b><span>vet</span></div>
    </div>
    <div class="advice-note">${goalTxt.note}<br><br>🏋️ <b>Training:</b> ${goalTxt.train}<br>
    ⚡ BMR (rustverbruik): ${T.bmr} kcal</div>`;

  renderWeightChart();
}

$("btn-log-weight").addEventListener("click", () => {
  showModal(`
    <h2>Weeg-moment</h2>
    <label>Gewicht vandaag (kg)</label>
    <input type="number" inputmode="decimal" id="w-input" value="${S.profile ? S.profile.weight : ""}">
    <div class="row2" style="margin-top:16px;margin-bottom:0">
      <button class="btn-secondary" id="m-cancel">Annuleer</button>
      <button class="btn-primary" id="m-ok">Opslaan</button>
    </div>`);
  $("m-cancel").addEventListener("click", closeModal);
  $("m-ok").addEventListener("click", () => {
    const kg = +$("w-input").value;
    if (!kg) { toast("Vul je gewicht in"); return; }
    S.weights = S.weights.filter((w) => w.date !== todayKey());
    S.weights.push({ date: todayKey(), kg });
    S.weights.sort((a, b) => (a.date > b.date ? 1 : -1));
    if (S.profile) S.profile.weight = kg; // targets rekenen met actueel gewicht
    save(); closeModal(); render();
    toast("Gewicht opgeslagen ✓");
  });
});

function renderWeightChart() {
  const svg = $("weight-chart");
  const ws = S.weights;
  if (ws.length < 2) {
    svg.innerHTML = `<text x="160" y="75" fill="#8b93a7" font-size="13" text-anchor="middle">Log minimaal 2 weeg-momenten voor een grafiek</text>`;
    $("weight-info").textContent = ws.length === 1 ? `Laatste meting: ${ws[0].kg} kg (${fmtDate(ws[0].date)})` : "";
    return;
  }
  const last = ws.slice(-20);
  const min = Math.min(...last.map((w) => w.kg)) - 1;
  const max = Math.max(...last.map((w) => w.kg)) + 1;
  const X = (i) => 12 + (i / (last.length - 1)) * 296;
  const Y = (kg) => 12 + (1 - (kg - min) / (max - min)) * 110;
  const pts = last.map((w, i) => `${X(i)},${Y(w.kg)}`).join(" ");
  svg.innerHTML = `
    <polyline points="${pts}" fill="none" stroke="#ffb020" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${last.map((w, i) => `<circle cx="${X(i)}" cy="${Y(w.kg)}" r="3" fill="#ffb020"/>`).join("")}
    <text x="12" y="135" fill="#8b93a7" font-size="10">${last[0].kg} kg</text>
    <text x="308" y="135" fill="#8b93a7" font-size="10" text-anchor="end">${last[last.length - 1].kg} kg</text>`;
  const diff = (last[last.length - 1].kg - last[0].kg).toFixed(1);
  $("weight-info").textContent = `${diff > 0 ? "+" : ""}${diff} kg sinds ${fmtDate(last[0].date)} · ${last.length} metingen`;
}

// ---------- Export / import ----------
$("btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "gymamigo-backup.json";
  a.click();
  toast("Backup gedownload ✓");
});
$("btn-import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.sessions || !data.foodLog) throw new Error("ongeldig");
      S = data; save(); render();
      toast("Data geïmporteerd ✓");
    } catch { toast("Ongeldig backup-bestand"); }
  };
  reader.readAsText(file);
});

// ---------- Modal ----------
function showModal(html) {
  $("modal-card").innerHTML = html;
  $("modal").classList.remove("hidden");
}
function closeModal() { $("modal").classList.add("hidden"); }
function confirmModal(msg, onOk) {
  showModal(`<h2>${esc(msg)}</h2>
    <div class="row2" style="margin-top:16px;margin-bottom:0">
      <button class="btn-secondary" id="m-cancel">Nee</button>
      <button class="btn-primary" id="m-ok">Ja</button>
    </div>`);
  $("m-cancel").addEventListener("click", closeModal);
  $("m-ok").addEventListener("click", () => { closeModal(); onOk(); });
}
$("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeModal(); });

// ---------- Render ----------
function render() {
  const p = S.profile;
  $("hdr-hello").textContent = p ? `Hoi ${p.name}! 👋` : "Hoi!";
  const now = new Date();
  $("hdr-date").textContent = `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;
  $("hdr-streak").textContent = `🔥 ${streak()}`;
  renderWeek();
  renderHistory();
  if (S.schema) renderSchema();
  renderFood();
  renderGoals();
}

// ---------- Init ----------
if (!S.profile) $("onboarding").classList.remove("hidden");
render();

// Service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
