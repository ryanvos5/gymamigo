// ===== Amigo — jouw fitness & voedings-assistent =====
// Begrijpt Nederlandse berichten via patroonherkenning + de oefening/voeding-database.
"use strict";

// Stuksgewichten (gram per stuk) voor "ik eet een appel"-invoer
const PIECES = {
  "Appel": 130, "Banaan": 120, "Sinaasappel": 130, "Ei (heel, ±50g p.st.)": 50,
  "Volkorenbrood (per snee ±35g)": 35, "Wit brood": 35, "Rijstwafel (±8g p.st.)": 8,
  "Proteïnereep": 55, "Wrap / tortilla": 60, "Pizza (gemiddeld)": 400,
  "Hamburger (broodje)": 220, "Cola": 330, "Cola Zero": 330, "Bier": 250,
  "Wijn (rood)": 125, "Sinaasappelsap": 250, "Cappuccino (halfvolle melk)": 150,
  "Halfvolle melk": 250, "Mango": 200, "Avocado": 140,
  "Pindakaas": 15, "Jam": 15, "Hagelslag": 15, "Honing": 15, "Boter": 10, "Hummus": 30,
  "Olijfolie": 10, "Kaas (48+)": 20, "30+ kaas": 20, "Whey proteïne (poeder)": 30,
  "Havermout (droog)": 50, "Chocolade (melk)": 25, "Chocolade (puur)": 25, "Chips": 30,
  "Noten (gemengd)": 25, "Amandelen": 25, "Magere kwark": 250, "Skyr": 150,
  "Griekse yoghurt (0%)": 150, "Griekse yoghurt (vol)": 150,
};

const NUM_WORDS = { "een": 1, "één": 1, "twee": 2, "drie": 3, "vier": 4, "vijf": 5, "zes": 6, "zeven": 7, "acht": 8, "negen": 9, "tien": 10, "half": 0.5, "halve": 0.5 };

if (!S.chat) S.chat = [];
if (!S.chatDraft) S.chatDraft = null;
let lastChatEx = null; // laatst genoemde oefening in actieve sessie

// ---------- Chat UI ----------
function chatAdd(who, html) {
  S.chat.push({ who, html });
  if (S.chat.length > 60) S.chat = S.chat.slice(-60);
  localStorage.setItem(STORE_KEY, JSON.stringify(S)); // niet via save(): geen sync-push per bericht nodig
  renderChat();
}

function renderChat() {
  const wrap = $("chat-messages");
  if (!wrap) return;
  if (!S.chat.length) {
    const name = S.profile ? " " + S.profile.name : "";
    chatAdd("a", `Hoi${esc(name)}! 👋 Ik ben <b>Amigo</b>, je fitness- en voedingscoach. Praat gewoon tegen me:<br><br>
      🍎 <i>"ik eet een appel"</i> of <i>"150 gram kipfilet"</i><br>
      🏋️ <i>"start een sessie"</i> en geef je sets door<br>
      📋 <i>"maak een schema"</i><br>
      ⚖️ <i>"ik weeg 82 kg"</i><br>
      ❓ <i>"hoeveel kcal heb ik nog?"</i>`);
    return;
  }
  wrap.innerHTML = S.chat.map((m) =>
    `<div class="msg ${m.who === "u" ? "me" : "amigo"}">${m.html}</div>`).join("");
  wrap.scrollTop = wrap.scrollHeight;
  const page = document.scrollingElement || document.documentElement;
  page.scrollTop = page.scrollHeight;
}

function chatChips() {
  const chips = S.chatDraft
    ? ["Klaar met trainen", "Annuleer sessie"]
    : ["Ik eet ", "Start een sessie", "Maak een schema", "Hoeveel kcal nog?", "Ik weeg  kg"];
  $("chat-chips").innerHTML = chips.map((c) => `<button class="chip" data-chip="${esc(c)}">${esc(c.trim())}</button>`).join("");
  $("chat-chips").querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    const v = b.dataset.chip;
    if (v.endsWith(" ") || v.includes("  ")) { $("chat-input").value = v.replace("  ", " "); $("chat-input").focus(); }
    else handleMessage(v);
  }));
}

// ---------- Tekst-helpers ----------
// verwijdert leestekens maar behoudt komma/punt binnen getallen ("81,5")
function norm(s) { return s.toLowerCase().replace(/[!?;:]/g, " ").replace(/[.,](?!\d)/g, " ").replace(/\s+/g, " ").trim(); }
function parseNum(w) {
  if (NUM_WORDS[w] !== undefined) return NUM_WORDS[w];
  const n = parseFloat(String(w).replace(",", "."));
  return isNaN(n) ? null : n;
}

// Beste match uit een lijst met namen (score op woord-prefixen)
function bestMatch(text, items, nameOf) {
  const words = norm(text).split(" ").filter((w) => w.length >= 3);
  let best = null, bestScore = 0;
  for (const item of items) {
    const nameWords = norm(nameOf(item)).split(" ").filter((w) => w.length >= 3);
    let score = 0;
    for (const tw of words) for (const nw of nameWords) {
      if (nw === tw) score += 3;
      else if (nw.startsWith(tw) && tw.length >= 4) score += 2;
      else if (tw.startsWith(nw)) score += 2;
    }
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return bestScore >= 2 ? best : null;
}

const EX_ALIASES = {
  "benchen": "bench", "benchpress": "bench", "bankdrukken": "bench", "squatten": "squat",
  "squats": "squat", "deadliften": "deadlift", "optrekken": "pullup", "pullups": "pullup",
  "opdrukken": "pushup", "pushups": "pushup", "hardlopen": "run", "rennen": "run",
  "fietsen": "bike", "roeien": "row", "zwemmen": "swim", "wandelen": "walk",
  "biceps": "dbcurl", "curlen": "dbcurl", "lunges": "lunge", "planken": "plank",
};
function findExercise(text) {
  const t = norm(text);
  for (const [alias, id] of Object.entries(EX_ALIASES)) {
    if (t.includes(alias)) return exById(id);
  }
  return bestMatch(text, EXERCISES, (e) => e.name + " " + e.muscle);
}

// ---------- Intents ----------
function handleMessage(raw) {
  const text = raw.trim();
  if (!text) return;
  chatAdd("u", esc(text));
  $("chat-input").value = "";
  const t = norm(text);
  setTimeout(() => {
    let reply;
    try { reply = respond(text, t); }
    catch (e) { reply = "Oeps, daar ging iets mis. Probeer het anders te zeggen 🙂"; }
    chatAdd("a", reply);
    chatChips();
  }, 250);
}

function respond(raw, t) {
  // --- Actieve sessie: sets doorkrijgen / afronden ---
  if (S.chatDraft) {
    if (/\b(klaar|stop|opslaan|einde|gedaan)\b/.test(t)) return finishChatSession();
    if (/\b(annuleer|cancel|weg|verwijder de sessie)\b/.test(t)) {
      S.chatDraft = null; lastChatEx = null; save(); render();
      return "Sessie geannuleerd. Geen zorgen, volgende keer beter! 💪";
    }
    const setReply = tryParseSet(raw, t);
    if (setReply) return setReply;
  }

  // --- Sessie starten ---
  if (/\bstart\b/.test(t) && /(sessie|training|workout|schema)/.test(t)) return startChatSession(t);

  // --- Schema maken ---
  if (/(maak|nieuw|genereer|wil)\b.*\b(schema|trainingsplan|plan)/.test(t)) {
    generateSchema(); renderSchema();
    $("schema-card").style.display = "block";
    const days = S.schema.map((d) => "• " + esc(d.title)).join("<br>");
    return `Ik heb een schema voor je gemaakt op basis van je doel (<b>${esc(S.goal)}</b>):<br><br>${days}<br><br>Je vindt het in de Gym-tab. Zeg <i>"start een sessie"</i> om te beginnen! 📋`;
  }

  // --- Gewicht loggen ---
  const wMatch = t.match(/\bweeg\b[^0-9]*(\d+(?:[.,]\d+)?)|\bgewicht\b[^0-9]*(\d+(?:[.,]\d+)?)/);
  if (wMatch) {
    const kg = parseFloat((wMatch[1] || wMatch[2]).replace(",", "."));
    if (kg > 25 && kg < 400) {
      S.weights = S.weights.filter((w) => w.date !== todayKey());
      S.weights.push({ date: todayKey(), kg });
      S.weights.sort((a, b) => (a.date > b.date ? 1 : -1));
      const prev = S.profile ? S.profile.weight : null;
      if (S.profile) S.profile.weight = kg;
      save(); render();
      const diff = prev ? (kg - prev).toFixed(1) : null;
      return `⚖️ Gewicht gelogd: <b>${kg} kg</b>${diff && diff != 0 ? ` (${diff > 0 ? "+" : ""}${diff} kg t.o.v. vorige)` : ""}. Je doelen zijn bijgewerkt op basis van je nieuwe gewicht.`;
    }
  }

  // --- Doel wijzigen ---
  if (/\b(wil|doel)\b/.test(t)) {
    let g = null;
    if (/afvallen|vet verliezen|gewicht verliezen|cutten/.test(t)) g = "afvallen";
    else if (/spieropbouw|spiermassa|aankomen|bulken|spieren/.test(t)) g = "spieropbouw";
    else if (/onderhoud|op gewicht blijven/.test(t)) g = "onderhoud";
    if (g) {
      S.goal = g; S.schema = null; save(); render();
      const T = targets();
      return `🎯 Doel gezet op <b>${g}</b>! Je nieuwe targets: <b>${T.kcal} kcal</b> en <b>${T.protein} g eiwit</b> per dag. Zeg <i>"maak een schema"</i> voor een passend trainingsplan.`;
    }
  }

  // --- Vragen ---
  if (/hoeveel|wat is|hoe sta/.test(t)) {
    const T = targets();
    const items = S.foodLog[todayKey()] || [];
    const sum = items.reduce((a, f) => ({ kcal: a.kcal + f.kcal, p: a.p + f.p }), { kcal: 0, p: 0 });
    if (/(kcal|calorie)/.test(t)) {
      const left = Math.round(T.kcal - sum.kcal);
      return left >= 0
        ? `Je hebt vandaag <b>${Math.round(sum.kcal)} kcal</b> gegeten. Nog <b>${left} kcal</b> te gaan tot je doel van ${T.kcal} kcal. 🍽️`
        : `Je zit vandaag op <b>${Math.round(sum.kcal)} kcal</b> — dat is <b>${-left} kcal boven</b> je doel van ${T.kcal}. Morgen weer een nieuwe dag! 💙`;
    }
    if (/eiwit|prote/.test(t)) {
      return `Je zit vandaag op <b>${Math.round(sum.p)} g eiwit</b> van de ${T.protein} g. ${sum.p >= T.protein ? "Doel gehaald! 💪" : `Nog ${Math.round(T.protein - sum.p)} g te gaan — kwark of kip is je vriend.`}`;
    }
    if (/getraind|training|week/.test(t)) {
      const now = new Date(); const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      const days = new Set(S.sessions.filter((s) => s.date >= dateKey(monday)).map((s) => s.date)).size;
      return `Je hebt deze week <b>${days}×</b> getraind. Streak: 🔥 ${streak()} dagen. ${days >= 3 ? "Lekker bezig!" : "Kom op, we gaan!"}`;
    }
    if (/doel|target/.test(t)) {
      return `Je doel is <b>${esc(S.goal)}</b>: ${T.kcal} kcal en ${T.protein} g eiwit per dag. Check de Goals-tab voor alle details. 🎯`;
    }
  }

  // --- Eten loggen ---
  const foodReply = tryLogFood(raw, t);
  if (foodReply) return foodReply;

  // --- Begroeting / help ---
  if (/^(hoi|hey|hallo|yo|goedemorgen|goedemiddag|goedenavond|hi)\b/.test(t)) {
    return `Hoi${S.profile ? " " + esc(S.profile.name) : ""}! 👋 Waar kan ik mee helpen? Eten loggen, een sessie starten, of je voortgang checken?`;
  }
  if (/help|wat kan/.test(t)) {
    return `Dit kan ik voor je doen:<br><br>🍎 Eten loggen — <i>"ik eet 150 gram kipfilet"</i><br>🏋️ Sessie via chat — <i>"start een sessie"</i>, dan <i>"bankdrukken 3x10 60 kg"</i>, en <i>"klaar"</i><br>📋 <i>"maak een schema"</i><br>⚖️ <i>"ik weeg 82 kg"</i><br>🎯 <i>"ik wil afvallen"</i><br>❓ <i>"hoeveel eiwit heb ik nog?"</i>`;
  }

  return `Hmm, dat snap ik nog niet helemaal 🤔 Probeer bijvoorbeeld:<br>🍎 <i>"ik eet een banaan"</i><br>🏋️ <i>"start een sessie"</i><br>❓ <i>"help"</i> voor alles wat ik kan.`;
}

// ---------- Eten loggen ----------
const FOOD_ALIASES = {
  "eieren": "Ei (heel, ±50g p.st.)", "ei": "Ei (heel, ±50g p.st.)", "eitje": "Ei (heel, ±50g p.st.)",
  "boterham": "Volkorenbrood (per snee ±35g)", "brood": "Volkorenbrood (per snee ±35g)",
  "kip": "Kipfilet (gegrild)", "rijst": "Witte rijst (gekookt)", "kwark": "Magere kwark",
  "yoghurt": "Griekse yoghurt (0%)", "melk": "Halfvolle melk", "shake": "Whey proteïne (poeder)",
  "eiwitshake": "Whey proteïne (poeder)", "whey": "Whey proteïne (poeder)", "reep": "Proteïnereep",
  "noten": "Noten (gemengd)", "vis": "Zalm", "gehakt": "Rundergehakt (mager)", "pasta": "Pasta (gekookt)",
  "aardappelen": "Aardappel (gekookt)", "friet": "Friet", "patat": "Friet", "kaas": "Kaas (48+)",
};
function tryLogFood(raw, t) {
  const explicit = /\b(eet|gegeten|at|ate|log|neem|genomen|ontbijt|lunch|avondeten|snack|drink|gedronken)\b/.test(t);
  // splits op " en " / " met " voor meerdere items ("2 boterhammen met pindakaas")
  const parts = raw.split(/\b en \b|\b met \b|,/i).map((p) => p.trim()).filter(Boolean);
  const logged = [];
  for (const part of parts) {
    let food = null;
    for (const w of norm(part).split(" ")) {
      for (const key of Object.keys(FOOD_ALIASES)) {
        if (w === key || (key.length >= 4 && w.startsWith(key)) || (w.length >= 4 && key.startsWith(w))) {
          food = allFoods().find((f) => f.name === FOOD_ALIASES[key]);
          break;
        }
      }
      if (food) break;
    }
    if (!food) food = bestMatch(part, allFoods(), (f) => f.name);
    if (!food) continue;
    // hoeveelheid: "150 gram", "2x", "twee", of standaard 1 stuk / 100 g
    const pt = norm(part);
    let grams = null;
    const gMatch = pt.match(/(\d+(?:[.,]\d+)?)\s*(?:gram|gr|g)\b/);
    if (gMatch) grams = parseFloat(gMatch[1].replace(",", "."));
    else {
      let count = null;
      const words = pt.split(" ");
      for (const w of words) { const n = parseNum(w); if (n !== null && n > 0 && n <= 20) { count = n; break; } }
      const piece = PIECES[food.name];
      if (count !== null) grams = (piece || 100) * count;
      else grams = piece || 100;
    }
    const mult = grams / 100;
    if (!S.foodLog[todayKey()]) S.foodLog[todayKey()] = [];
    S.foodLog[todayKey()].push({
      name: food.name, grams: Math.round(grams),
      kcal: food.kcal * mult, p: food.p * mult, c: food.c * mult, f: food.f * mult,
    });
    S.recentFoods = [food.name, ...S.recentFoods.filter((n) => n !== food.name)].slice(0, 10);
    logged.push({ food, grams });
  }
  if (!logged.length) return explicit ? `Ik kon dat product niet vinden 😕 Probeer een andere naam (bijv. <i>"kipfilet"</i> of <i>"havermout"</i>), of voeg het toe als eigen product in de Food-tab.` : null;
  save(); render();
  const T = targets();
  const items = S.foodLog[todayKey()];
  const sum = items.reduce((a, f) => a + f.kcal, 0);
  const lines = logged.map(({ food, grams }) =>
    `✅ <b>${esc(food.name)}</b> (${Math.round(grams)} g): ${Math.round(food.kcal * grams / 100)} kcal · ${Math.round(food.p * grams / 100)} g eiwit`).join("<br>");
  const left = Math.round(T.kcal - sum);
  return `${lines}<br><br>${left >= 0 ? `Nog <b>${left} kcal</b> over vandaag.` : `Je zit <b>${-left} kcal</b> boven je doel.`}`;
}

// ---------- Sessie via chat ----------
function startChatSession(t) {
  const dayMatch = t.match(/dag\s*(\d)/);
  let exs = [], intro = "";
  if (/schema/.test(t) || dayMatch) {
    if (!S.schema) generateSchema();
    const idx = dayMatch ? Math.min(+dayMatch[1] - 1, S.schema.length - 1) : (S.sessions.length % S.schema.length);
    const day = S.schema[idx];
    exs = day.exercises.filter((e) => exById(e.id)).map((e) => {
      const ex = exById(e.id);
      return ex.cardio ? { exId: e.id, minutes: 0, sets: [] } : { exId: e.id, sets: [] };
    });
    intro = `We doen <b>${esc(day.title)}</b> (${day.scheme}):<br>` +
      day.exercises.map((e) => "• " + esc(e.name)).join("<br>") + "<br><br>";
  }
  S.chatDraft = { date: todayKey(), exercises: exs };
  lastChatEx = null;
  save();
  return `🏋️ <b>Sessie gestart!</b> ${intro}Geef je sets door, bijvoorbeeld:<br><i>"bankdrukken 3x10 60 kg"</i><br><i>"nog een set 8 op 65"</i><br><i>"hardlopen 20 minuten"</i><br><br>Zeg <b>"klaar"</b> als je klaar bent.`;
}

function tryParseSet(raw, t) {
  const ex = findExercise(raw) || lastChatEx;
  if (!ex) return null;

  // cardio: minuten
  const minMatch = t.match(/(\d+)\s*(?:min|minuten|minuut)\b/);
  if (ex.cardio) {
    if (!minMatch) return `Hoeveel minuten <b>${esc(ex.name)}</b>? Bijv. <i>"20 minuten"</i>.`;
    let entry = S.chatDraft.exercises.find((e) => e.exId === ex.id);
    if (!entry) { entry = { exId: ex.id, minutes: 0, sets: [] }; S.chatDraft.exercises.push(entry); }
    entry.minutes += +minMatch[1];
    lastChatEx = ex;
    save();
    return liveReply(`🏃 <b>${esc(ex.name)}</b>: ${entry.minutes} min genoteerd.`);
  }

  // kracht: "3x10 60", "3 sets van 10 met 60 kg", "10 herhalingen op 60", "nog een set 8 op 65"
  let sets = 1, reps = null, weight = 0;
  let m = t.match(/(\d+)\s*(?:x|×)\s*(\d+)(?:\s*(?:met|op|@|x|×)?\s*(\d+(?:[.,]\d+)?)\s*(?:kg|kilo)?)?/);
  if (m) { sets = +m[1]; reps = +m[2]; weight = m[3] ? parseFloat(m[3].replace(",", ".")) : 0; }
  else {
    m = t.match(/(\d+)\s*sets?(?:\s*van)?\s*(\d+)(?:\s*(?:herhalingen|herh|reps)?)?(?:\s*(?:met|op|@)\s*(\d+(?:[.,]\d+)?)\s*(?:kg|kilo)?)?/);
    if (m) { sets = +m[1]; reps = +m[2]; weight = m[3] ? parseFloat(m[3].replace(",", ".")) : 0; }
    else {
      m = t.match(/(\d+)\s*(?:herhalingen|herh|reps)(?:\s*(?:met|op|@)\s*(\d+(?:[.,]\d+)?)\s*(?:kg|kilo)?)?/);
      if (m) { reps = +m[1]; weight = m[2] ? parseFloat(m[2].replace(",", ".")) : 0; }
      else {
        // "nog een set 8 op 65" / "set 8 65"
        m = t.match(/set\s*(?:van\s*)?(\d+)(?:\s*(?:met|op|@)?\s*(\d+(?:[.,]\d+)?)\s*(?:kg|kilo)?)?/);
        if (m) { reps = +m[1]; weight = m[2] ? parseFloat(m[2].replace(",", ".")) : 0; }
      }
    }
  }
  if (reps === null) {
    if (findExercise(raw)) { lastChatEx = ex; return `Oké, <b>${esc(ex.name)}</b>! Hoeveel sets? Bijv. <i>"3x10 60 kg"</i>.`; }
    return null;
  }
  if (sets < 1 || sets > 20 || reps < 1 || reps > 100) return null;

  let entry = S.chatDraft.exercises.find((e) => e.exId === ex.id);
  if (!entry) { entry = { exId: ex.id, sets: [] }; S.chatDraft.exercises.push(entry); }
  for (let i = 0; i < sets; i++) entry.sets.push({ reps, weight });
  lastChatEx = ex;
  save();
  return liveReply(`💪 <b>${esc(ex.name)}</b>: ${sets} set${sets > 1 ? "s" : ""} × ${reps} herh.${weight ? " met " + weight + " kg" : ""} genoteerd.`);
}

function liveReply(prefix) {
  const totals = sessionTotals(S.chatDraft);
  return `${prefix}<br><span class="muted">Tussenstand: ${totals.kcal} kcal · ${totals.vol} kg volume · ${totals.sets} sets</span>`;
}

function finishChatSession() {
  const d = S.chatDraft;
  d.exercises.forEach((e) => { if (e.sets) e.sets = e.sets.filter((s) => s.reps > 0); });
  d.exercises = d.exercises.filter((e) => {
    const ex = exById(e.exId);
    return ex && (ex.cardio ? e.minutes > 0 : e.sets.length > 0);
  });
  if (!d.exercises.length) {
    S.chatDraft = null; save();
    return "Je had nog geen sets doorgegeven, dus ik heb niets opgeslagen. Volgende keer! 🙂";
  }
  d.id = Date.now();
  const totals = sessionTotals(d);
  S.sessions.push(d);
  S.sessions.sort((a, b) => (a.date < b.date ? 1 : -1));
  S.chatDraft = null;
  lastChatEx = null;
  save(); render();
  return `🎉 <b>Sessie opgeslagen!</b><br><br>🔥 ${totals.kcal} kcal verbrand<br>🏋️ ${totals.vol} kg totaal volume<br>📊 ${totals.sets} sets<br><br>Streak: 🔥 ${streak()} dagen. Goed bezig${S.profile ? ", " + esc(S.profile.name) : ""}!`;
}

// ---------- Init ----------
$("chat-send").addEventListener("click", () => handleMessage($("chat-input").value));
$("chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter") handleMessage($("chat-input").value); });
renderChat();
chatChips();
