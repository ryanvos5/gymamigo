// ===== GymAmigo cloud sync (Firebase Auth + Firestore via REST) =====
// Vul na het aanmaken van je Firebase-project deze twee waarden in:
const FB = {
  apiKey: "",     // Firebase Web API key
  projectId: "",  // Firebase project-ID
};

const AUTH_KEY = "gymamigo_auth";
let AUTH = null;
try { AUTH = JSON.parse(localStorage.getItem(AUTH_KEY)); } catch (e) { AUTH = null; }

function cloudEnabled() { return !!(FB.apiKey && FB.projectId); }
function loggedIn() { return !!(AUTH && AUTH.refreshToken); }
function saveAuth() {
  if (AUTH) localStorage.setItem(AUTH_KEY, JSON.stringify(AUTH));
  else localStorage.removeItem(AUTH_KEY);
}

// ---------- Auth REST ----------
const FB_ERRORS = {
  EMAIL_EXISTS: "Dit e-mailadres heeft al een account. Probeer in te loggen.",
  EMAIL_NOT_FOUND: "Onbekende combinatie van e-mail en wachtwoord.",
  INVALID_PASSWORD: "Onbekende combinatie van e-mail en wachtwoord.",
  INVALID_LOGIN_CREDENTIALS: "Onbekende combinatie van e-mail en wachtwoord.",
  INVALID_EMAIL: "Dat is geen geldig e-mailadres.",
  WEAK_PASSWORD: "Wachtwoord moet minimaal 6 tekens zijn.",
  TOO_MANY_ATTEMPTS_TRY_LATER: "Te veel pogingen — probeer het later opnieuw.",
};
function fbError(code) {
  const key = String(code || "").split(" ")[0];
  return FB_ERRORS[key] || "Er ging iets mis. Controleer je internetverbinding.";
}

async function fbAuth(endpoint, body) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${FB.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(fbError(data.error && data.error.message));
  return data;
}

async function ensureToken() {
  if (!AUTH) throw new Error("Niet ingelogd");
  if (AUTH.exp && Date.now() < AUTH.exp - 120000) return AUTH.idToken;
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FB.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(AUTH.refreshToken)}`,
  });
  const data = await res.json();
  if (!res.ok) { // refresh token ongeldig → uitloggen
    AUTH = null; saveAuth(); renderAccount();
    throw new Error("Sessie verlopen — log opnieuw in.");
  }
  AUTH.idToken = data.id_token;
  AUTH.refreshToken = data.refresh_token;
  AUTH.uid = data.user_id;
  AUTH.exp = Date.now() + (+data.expires_in || 3600) * 1000;
  saveAuth();
  return AUTH.idToken;
}

// ---------- Firestore REST ----------
function docUrl() {
  return `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents/users/${AUTH.uid}`;
}

async function cloudPull() {
  const token = await ensureToken();
  const res = await fetch(docUrl(), { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Ophalen mislukt");
  const doc = await res.json();
  try { return JSON.parse(doc.fields.state.stringValue); } catch (e) { return null; }
}

async function cloudPush() {
  const token = await ensureToken();
  const res = await fetch(docUrl() + "?updateMask.fieldPaths=state&updateMask.fieldPaths=ts", {
    method: "PATCH",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: {
      state: { stringValue: JSON.stringify(S) },
      ts: { integerValue: String(S._ts || Date.now()) },
    } }),
  });
  if (!res.ok) throw new Error("Synchroniseren mislukt");
  AUTH.lastSync = Date.now();
  saveAuth();
}

// ---------- Sync engine ----------
let pushTimer = null, syncBusy = false;
function schedulePush() {
  if (!cloudEnabled() || !loggedIn()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try { await cloudPush(); setSyncStatus("✓ Gesynchroniseerd"); }
    catch (e) { setSyncStatus("⚠ Nog niet gesynchroniseerd"); }
  }, 1500);
}

async function syncNow(showToast) {
  if (!cloudEnabled() || !loggedIn() || syncBusy) return;
  syncBusy = true;
  setSyncStatus("Bezig met synchroniseren…");
  try {
    const remote = await cloudPull();
    if (remote && (remote._ts || 0) > (S._ts || 0)) {
      S = remote;
      localStorage.setItem(STORE_KEY, JSON.stringify(S));
      render();
    } else {
      await cloudPush();
    }
    setSyncStatus("✓ Gesynchroniseerd");
    if (showToast) toast("Gesynchroniseerd ✓");
  } catch (e) {
    setSyncStatus("⚠ " + e.message);
    if (showToast) toast(e.message);
  }
  syncBusy = false;
}

function setSyncStatus(txt) {
  const el = document.getElementById("sync-status");
  if (el) el.textContent = txt;
}

// ---------- Account UI ----------
function renderAccount() {
  const card = document.getElementById("account-card");
  if (!card) return;
  if (!cloudEnabled()) {
    card.innerHTML = `<div class="card-title">☁️ Account & synchronisatie</div>
      <p class="muted small">Binnenkort beschikbaar — dan kun je een account maken zodat je data veilig in de cloud staat.</p>`;
    return;
  }
  if (loggedIn()) {
    card.innerHTML = `
      <div class="card-title">☁️ Account & synchronisatie</div>
      <p class="small" style="margin-bottom:4px">Ingelogd als <b>${esc(AUTH.email || "")}</b></p>
      <p class="muted small" id="sync-status" style="margin-bottom:12px">${AUTH.lastSync ? "✓ Gesynchroniseerd" : "Nog niet gesynchroniseerd"}</p>
      <div class="row2" style="margin-bottom:0">
        <button class="btn-secondary" id="btn-sync-now">↻ Synchroniseer</button>
        <button class="btn-secondary" id="btn-logout">Uitloggen</button>
      </div>`;
    document.getElementById("btn-sync-now").addEventListener("click", () => syncNow(true));
    document.getElementById("btn-logout").addEventListener("click", () => {
      confirmModal("Uitloggen? Je data blijft op dit apparaat én in de cloud staan.", () => {
        AUTH = null; saveAuth(); renderAccount();
        toast("Uitgelogd");
      });
    });
  } else {
    card.innerHTML = `
      <div class="card-title">☁️ Account & synchronisatie</div>
      <p class="muted small" style="margin-bottom:12px">Maak een gratis account, dan staat je data veilig in de cloud en kun je op elk apparaat inloggen.</p>
      <div class="row2" style="margin-bottom:0">
        <button class="btn-primary" id="btn-signup">Account maken</button>
        <button class="btn-secondary" id="btn-login">Inloggen</button>
      </div>`;
    document.getElementById("btn-signup").addEventListener("click", () => authModal(true));
    document.getElementById("btn-login").addEventListener("click", () => authModal(false));
  }
}

function authModal(isSignup) {
  showModal(`
    <h2>${isSignup ? "Account maken" : "Inloggen"}</h2>
    <label>E-mailadres</label>
    <input type="email" id="auth-email" inputmode="email" autocomplete="email" placeholder="jij@voorbeeld.nl">
    <label>Wachtwoord${isSignup ? " (min. 6 tekens)" : ""}</label>
    <input type="password" id="auth-pass" autocomplete="${isSignup ? "new-password" : "current-password"}">
    <p class="muted small" id="auth-err" style="margin-top:8px"></p>
    <div class="row2" style="margin-top:12px;margin-bottom:0">
      <button class="btn-secondary" id="m-cancel">Annuleer</button>
      <button class="btn-primary" id="m-ok">${isSignup ? "Maak account" : "Log in"}</button>
    </div>`);
  document.getElementById("m-cancel").addEventListener("click", closeModal);
  document.getElementById("m-ok").addEventListener("click", async () => {
    const email = document.getElementById("auth-email").value.trim();
    const pass = document.getElementById("auth-pass").value;
    const err = document.getElementById("auth-err");
    if (!email || !pass) { err.textContent = "Vul e-mail en wachtwoord in."; return; }
    document.getElementById("m-ok").textContent = "Bezig…";
    try {
      const data = await fbAuth(isSignup ? "signUp" : "signInWithPassword",
        { email, password: pass, returnSecureToken: true });
      AUTH = {
        email: data.email, uid: data.localId,
        idToken: data.idToken, refreshToken: data.refreshToken,
        exp: Date.now() + (+data.expiresIn || 3600) * 1000,
      };
      saveAuth();
      closeModal();
      renderAccount();
      toast(isSignup ? "Account aangemaakt! ☁️" : "Ingelogd ✓");
      await syncNow(false);
    } catch (e) {
      err.textContent = e.message;
      document.getElementById("m-ok").textContent = isSignup ? "Maak account" : "Log in";
    }
  });
}

// ---------- Init ----------
window.addEventListener("online", () => schedulePush());
renderAccount();
if (cloudEnabled() && loggedIn()) syncNow(false);
