import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  browserLocalPersistence,
  setPersistence,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

let statePromise;
const state = {
  app: null,
  auth: null,
  db: null,
  user: null,
  profile: null,
  site: null,
  branchCode: 'default'
};

function buildPageId(slug, branchCode = 'default') {
  return `${branchCode || 'default'}__${slug}`;
}

function getBranchFromLocation(defaultBranch = 'default') {
  const params = new URLSearchParams(location.search);
  const queryBranch = params.get('branch');
  const storedBranch = localStorage.getItem('bnak_branch');
  const branch = queryBranch || storedBranch || defaultBranch;
  state.branchCode = branch;
  localStorage.setItem('bnak_branch', branch);
  return branch;
}

async function init() {
  if (statePromise) return statePromise;
  statePromise = (async () => {
    const res = await fetch('/api/runtime-config', { cache: 'no-store' });
    const config = await res.json();
    const app = getApps().length ? getApp() : initializeApp(config);
    const auth = getAuth(app);
    await setPersistence(auth, browserLocalPersistence);
    const db = getFirestore(app);
    state.app = app; state.auth = auth; state.db = db;
    return state;
  })();
  return statePromise;
}

export async function requireAuth({ admin = false } = {}) {
  await init();
  return new Promise((resolve) => {
    onAuthStateChanged(state.auth, async (user) => {
      state.user = user;
      if (!user) {
        const next = encodeURIComponent(location.pathname + location.search);
        location.replace(`/login?next=${next}`);
        return;
      }

      const snap = await getDoc(doc(state.db, 'users', user.uid));
      state.profile = snap.exists() ? snap.data() : null;

      if (admin && state.profile?.role !== 'admin') {
        location.replace('/index');
        return;
      }

      document.documentElement.dataset.authReady = 'true';
      document.body.style.opacity = '1';
      resolve({ user, profile: state.profile });
    }, (error) => {
      console.error(error);
      location.replace('/login');
    });
  });
}

export async function getSite() {
  await init();
  if (state.site) return state.site;
  const snap = await getDoc(doc(state.db, 'site', 'settings'));
  state.site = snap.exists() ? snap.data() : null;
  return state.site;
}

export async function getPage(slug, branchCode) {
  await init();
  const site = await getSite();
  const activeBranch = branchCode || getBranchFromLocation(site?.defaultBranchCode || 'default');
  const candidates = [buildPageId(slug, activeBranch), buildPageId(slug, 'default'), slug];
  for (const candidate of candidates) {
    const snap = await getDoc(doc(state.db, 'pages', candidate));
    if (snap.exists()) {
      return snap.data();
    }
  }
  throw new Error(`Page not found: ${slug}`);
}

export async function getPages() {
  await init();
  const site = await getSite();
  const branchCode = getBranchFromLocation(site?.defaultBranchCode || 'default');
  const snap = await getDocs(collection(state.db, 'pages'));
  return snap.docs.map((d) => d.data()).filter((page) => (page.branchCode || 'default') === branchCode);
}

export async function loadPageRuntime(slug, options = {}) {
  await requireAuth(options);
  const site = await getSite();
  getBranchFromLocation(site?.defaultBranchCode || 'default');
  const page = await getPage(slug, state.branchCode);
  bindSite(site);
  bindUserBadge();
  return { site, page, data: page.data || {}, headline: page.headline || {}, branchCode: state.branchCode };
}

function setText(selector, value) {
  if (value === undefined || value === null) return;
  document.querySelectorAll(selector).forEach((el) => {
    el.textContent = value;
  });
}

export function bindSite(site) {
  if (!site) return;
  setText('[data-bnak-app-name]', site.appName || 'BNAK Performance 2026');
  setText('[data-bnak-brand]', site.brand || 'Flash Express');
  setText('[data-bnak-branch]', site.branches?.find((branch) => branch.code === state.branchCode)?.name || state.branchCode);
  if (site.theme?.primary) document.documentElement.style.setProperty('--flash-yellow', site.theme.primary);
  if (site.theme?.dark) document.documentElement.style.setProperty('--flash-black', site.theme.dark);
}

export function bindUserBadge() {
  if (!state.user) return;
  const target = document.getElementById('bnak-user-badge');
  if (!target) return;
  const siteBranches = state.site?.branches || [{ code: 'default', name: 'สาขาหลัก', active: true }];
  target.innerHTML = `
    <div class="text-right">
      <p class="text-[10px] font-bold text-gray-400 uppercase leading-none">${state.profile?.role || 'user'}</p>
      <p class="text-sm font-bold text-slate-800">${state.user.email || 'signed in'}</p>
      <select id="bnak-branch-selector" class="mt-2 rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold">
        ${siteBranches.filter((branch) => branch.active !== false).map((branch) => `<option value="${branch.code}" ${branch.code === state.branchCode ? 'selected' : ''}>${branch.name}</option>`).join('')}
      </select>
    </div>
    <button id="bnak-logout-btn" class="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold">Logout</button>
  `;
  const btn = document.getElementById('bnak-logout-btn');
  btn?.addEventListener('click', async () => {
    await signOut(state.auth);
    location.replace('/login');
  });
  const branchSelector = document.getElementById('bnak-branch-selector');
  branchSelector?.addEventListener('change', (event) => {
    const branchCode = event.target.value;
    localStorage.setItem('bnak_branch', branchCode);
    const params = new URLSearchParams(location.search);
    params.set('branch', branchCode);
    location.search = params.toString();
  });
}
