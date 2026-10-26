import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  signInWithCustomToken,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

// Firebase's browser configuration is public. Private service-account credentials
// must remain on the Render server and are never included in this file.
const firebaseConfig = {
  apiKey: "AIzaSyAZh7WXL_xhuAfCY7lygUSs4-rb3zu6Yy4",
  authDomain: "arenaduels-7dc31.firebaseapp.com",
  projectId: "arenaduels-7dc31",
  storageBucket: "arenaduels-7dc31.firebasestorage.app",
  messagingSenderId: "91423044307",
  appId: "1:91423044307:web:08ce071648607e744c9a26"
};

const API_BASE = "https://arenaduels-relay.onrender.com";
const ACCOUNT_NAME_KEY = "arenaduels-account-username";

export function initializeAccountUi(nameInput, randomName) {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const modal = document.getElementById("account-modal");
  const openBtn = document.getElementById("btn-account");
  const signoutBtn = document.getElementById("btn-account-signout");
  const status = document.getElementById("account-status");
  const registerTab = document.getElementById("account-tab-register");
  const loginTab = document.getElementById("account-tab-login");
  const registerForm = document.getElementById("account-register-form");
  const loginForm = document.getElementById("account-login-form");
  const registerName = document.getElementById("account-register-username");
  const registerPassword = document.getElementById("account-register-password");
  const loginName = document.getElementById("account-login-username");
  const loginPassword = document.getElementById("account-login-password");
  const message = document.getElementById("account-message");
  const title = document.getElementById("account-modal-title");
  let accountUsername = localStorage.getItem(ACCOUNT_NAME_KEY) || "";
  let signedIn = false;
  let turnstileWidgetId = null;
  async function ensureTurnstileRendered() {
    for (let i = 0; i < 50 && !window.turnstile; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!window.turnstile) throw new Error("Human verification could not load. Please refresh and try again.");
    if (turnstileWidgetId === null) {
      turnstileWidgetId = window.turnstile.render("#account-turnstile", {
        sitekey: "0x4AAAAAAFnRKww-UlVDpSQT",
        theme: "dark"
      });
    } else {
      window.turnstile.reset(turnstileWidgetId);
    }
  }

  function showMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("error", isError);
  }
  function setMode(mode) {
    const registering = mode === "register";
    registerForm.classList.toggle("hidden", !registering);
    loginForm.classList.toggle("hidden", registering);
    registerTab.classList.toggle("btn-primary", registering);
    registerTab.classList.toggle("btn-secondary", !registering);
    loginTab.classList.toggle("btn-primary", !registering);
    loginTab.classList.toggle("btn-secondary", registering);
    title.textContent = registering ? "Create an account" : "Sign in";
    showMessage("");
  }
  async function getGeneratedName() {
    try {
      const response = await fetch(`${API_BASE}/api/auth/random-name`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not generate a username.");
      return data.username;
    } catch (err) {
      // The client fallback is only for the guest name. Account registration
      // still requires a server-generated available username.
      return randomName();
    }
  }
  async function refreshGeneratedName() {
    registerName.value = "Generating…";
    const generated = await getGeneratedName();
    registerName.value = generated;
  }
  function setGuestName() {
    accountUsername = "";
    localStorage.removeItem(ACCOUNT_NAME_KEY);
    nameInput.value = randomName();
    nameInput.readOnly = true;
    document.getElementById("btn-random-name").disabled = false;
    status.textContent = "Playing as guest";
    openBtn.classList.remove("hidden");
    signoutBtn.classList.add("hidden");
  }
  async function finishSignIn(token, username) {
    await signInWithCustomToken(auth, token);
    accountUsername = username;
    localStorage.setItem(ACCOUNT_NAME_KEY, username);
    nameInput.value = username;
    nameInput.readOnly = true;
    document.getElementById("btn-random-name").disabled = true;
    status.textContent = `Signed in as ${username}`;
    openBtn.classList.add("hidden");
    signoutBtn.classList.remove("hidden");
    showMessage(`Signed in as ${username}.`);
    setTimeout(() => modal.classList.add("hidden"), 700);
  }
  async function postAuth(path, username, password, turnstileToken = "") {
    const response = await fetch(`${API_BASE}/api/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ username, password, ...(path === "register" ? { turnstileToken } : {}) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Account request failed.");
    return data;
  }

  openBtn.addEventListener("click", async () => {
    modal.classList.remove("hidden");
    setMode("register");
    await refreshGeneratedName();
    try { await ensureTurnstileRendered(); }
    catch (err) { showMessage(err.message, true); }
  });
  document.getElementById("btn-account-close").addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.classList.add("hidden");
  });
  registerTab.addEventListener("click", async () => {
    setMode("register");
    if (!registerName.value || registerName.value === "Generating…") await refreshGeneratedName();
  });
  loginTab.addEventListener("click", () => setMode("login"));
  document.getElementById("account-reroll-name").addEventListener("click", refreshGeneratedName);
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = registerName.value.trim();
    const password = registerPassword.value;
    const submit = document.getElementById("account-register-submit");
    submit.disabled = true;
    showMessage("Creating account…");
    try {
      if (!username || username === "Generating…") throw new Error("Generate a username first.");
      const turnstileInput = document.querySelector('[name="cf-turnstile-response"]');
      const turnstileToken = turnstileInput?.value || "";
      if (!turnstileToken) throw new Error("Please complete the human verification first.");
      const data = await postAuth("register", username, password, turnstileToken);
      await finishSignIn(data.token, data.username);
      registerPassword.value = "";
    } catch (err) {
      showMessage(err.message, true);
      if (window.turnstile && turnstileWidgetId !== null) window.turnstile.reset(turnstileWidgetId);
      if (/taken|available|generate/i.test(err.message)) await refreshGeneratedName();
    } finally {
      submit.disabled = false;
    }
  });
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = document.getElementById("account-login-submit");
    submit.disabled = true;
    showMessage("Signing in…");
    try {
      const data = await postAuth("login", loginName.value.trim(), loginPassword.value);
      await finishSignIn(data.token, data.username);
      loginPassword.value = "";
    } catch (err) {
      showMessage(err.message, true);
    } finally {
      submit.disabled = false;
    }
  });
  signoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } finally {
      signedIn = false;
      setGuestName();
    }
  });

  onAuthStateChanged(auth, async (user) => {
    signedIn = Boolean(user);
    if (user) {
      try {
        const result = await user.getIdTokenResult();
        accountUsername = result.claims.username || accountUsername || localStorage.getItem(ACCOUNT_NAME_KEY) || "";
      } catch {}
      if (accountUsername) {
        localStorage.setItem(ACCOUNT_NAME_KEY, accountUsername);
        nameInput.value = accountUsername;
      }
      nameInput.readOnly = true;
      document.getElementById("btn-random-name").disabled = true;
      status.textContent = accountUsername ? `Signed in as ${accountUsername}` : "Signed in";
      openBtn.classList.add("hidden");
      signoutBtn.classList.remove("hidden");
    } else {
      setGuestName();
    }
  });
  setGuestName();
}
