/* auth.firebase.js — Firebase Auth + Firestore + espelho em localStorage
   - Login: email/senha e Google
   - Persistência: local
   - Espelha usuário em localStorage ("sc_user")
   - Header: “Olá, Nome ▾” + menu Perfil / Sair
   - Modal de autenticação reutilizável (openAuthModal)
   - Envia verificação por e-mail no cadastro
   - Esqueci a senha + reset
   - Troca de senha imediata (Perfil)
   - Excluir conta (com reautenticação quando necessário)
   - Aviso padronizado p/ checar Spam
   - 🔻 REMOVIDO: qualquer recurso de histórico de pedidos (saveOrder / getOrders)
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, setPersistence, browserLocalPersistence,
  onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, GoogleAuthProvider,
  signInWithPopup, signOut, updateProfile,
  sendEmailVerification, deleteUser,
  reauthenticateWithPopup, reauthenticateWithCredential, EmailAuthProvider,
  sendPasswordResetEmail, updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp, deleteDoc,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ==========================
   1) CONFIG DO FIREBASE
   ========================== */
const firebaseConfig = {
  apiKey: "AIzaSyAkV9v2dOtzoWDbG61ZydeFqwJMgzrvfH8",
  authDomain: "sabor-em-clicks.firebaseapp.com",
  projectId: "sabor-em-clicks",
  storageBucket: "sabor-em-clicks.appspot.com",
  messagingSenderId: "655596665853",
  appId: "1:655596665853:web:6688599864a590e190b794",
  measurementId: "G-PJDW95TRVW"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// Persistência local (Auth)
(async () => { try { await setPersistence(auth, browserLocalPersistence); } catch {} })();

// Firestore offline cache (endereços/perfil continuam a usar)
(async () => {
  try { await enableIndexedDbPersistence(db); }
  catch (e) { /* ok em múltiplas abas / sem suporte */ }
})();

/* ==========================
   2) UTILS DE DOM
   ========================== */
const $  = (id) => document.getElementById(id);

const show = (el) => { if (!el) return; el.hidden = false; el.classList?.remove('hidden'); if (el.style) el.style.display = 'block'; };
const hide = (el) => { if (!el) return; el.hidden = true;  el.classList?.add('hidden');    if (el.style) el.style.display = 'none'; };

/* Aviso padronizado de e-mail enviado (inclui dica de Spam/Lixo eletrônico) */
function emailSentNotice(texto) {
  const dica = 'Caso não veja na caixa de entrada, verifique também a pasta Lixo eletrônico/Spam e marque como "Não é spam".';
  const html = `📬 ${texto}<br><small style="display:block;margin-top:6px;color:#5c4033">${dica}</small>`;

  const authMsg = $('authMsg');
  if (authMsg) {
    authMsg.innerHTML = html;
    authMsg.style.display = 'block';
    authMsg.classList?.add('info');
    return;
  }
  try {
    const t = $('toast');
    if (t) {
      t.textContent = 'E-mail enviado. Verifique também o Spam/Lixo eletrônico.';
      t.style.display = 'block';
      setTimeout(() => (t.style.display = 'none'), 1600);
    } else {
      alert('E-mail enviado. ' + dica);
    }
  } catch {}
}

/* ==========================
   3) MODAL E HEADER
   ========================== */
const authModal = $('authModal');
const authTitle = $('authTitle');
const authMsg   = $('authMsg');
const authClose = $('authClose');
const authLater = $('authLater');
const tabEntrar = $('tabEntrar');
const tabCadastrar = $('tabCadastrar');
const formLogin    = $('formLogin');
const formCadastro = $('formCadastro');
const btnGoogle    = $('btnGoogle');

const linkForgot   = $('linkForgot');
const viewReset    = $('viewReset');
const resetEmail   = $('resetEmail');
const btnResetSend = $('btnResetSend');
const btnResetBack = $('btnResetBack');

const accountArea = $('accountArea');
const accountMenu = $('accountMenu');

/* ==========================
   4) FIRESTORE: USERS
   ========================== */
async function ensureUserDoc(user) {
  if (!user) return;
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);

  const base = {
    uid: user.uid,
    email: user.email || '',
    name: user.displayName || '',
  };

  if (!snap.exists()) {
    await setDoc(ref, {
      ...base,
      createdAt: serverTimestamp(),
      profile: {},
      addresses: []
    }, { merge: true });
  } else {
    await setDoc(ref, base, { merge: true });
  }
}

export async function getUserDoc(uid){
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}
export async function updateUserDoc(uid, data){
  const ref = doc(db, 'users', uid);
  await setDoc(ref, data, { merge: true });
}

/* ==========================
   5) TABS DO MODAL
   ========================== */
function setTab(which){
  const isLogin = which === 'login';
  tabEntrar?.classList.toggle('is-outlined', !isLogin);
  tabCadastrar?.classList.toggle('is-outlined', isLogin);
  formLogin?.classList.toggle('hidden', !isLogin);
  formCadastro?.classList.toggle('hidden', isLogin);
  if (authTitle) authTitle.textContent = isLogin ? 'Entrar' : 'Cadastrar';
  if (authMsg) { authMsg.classList?.remove('info'); }
  hide(authMsg);
}
function openModal(tab='login'){
  setTab(tab);
  if (authModal){
    authModal.hidden = false;
    authModal.classList?.remove('hidden');
    authModal.style.display = 'flex';
  }
}
function closeModal(){
  if (authModal){
    authModal.style.display = 'none';
    authModal.hidden = true;
    authModal.classList?.add('hidden');
  }
}
window.openAuthModal = (tab='login') => { try { openModal(tab); } catch {} };

/* ==========================
   6) LOCALSTORAGE (espelho)
   ========================== */
const LS_KEY = 'sc_user';
function setLocalUser(user){
  if (!user) { localStorage.removeItem(LS_KEY); return; }
  const data = {
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || '',
    provider: (user.providerData?.[0]?.providerId) || 'password',
    emailVerified: !!user.emailVerified
  };
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}
export function getLocalUser(){
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); }
  catch { return null; }
}

/* ==========================
   7) HEADER
   ========================== */
function renderHeader(user){
  if (!accountArea) return;

  let open = false;
  const toggle = (v)=>{
    open = (v ?? !open);
    open ? show(accountMenu) : hide(accountMenu);
    accountArea?.setAttribute('aria-expanded', String(open));
  };

  document.addEventListener('click', (ev)=>{
    if (open && !ev.target.closest?.('.account')) toggle(false);
  });

  if (!user) {
    accountArea.textContent = 'Entrar';
    accountArea.setAttribute('aria-expanded', 'false');
    accountArea.onclick = (e)=>{ e.preventDefault(); openModal('login'); };
    hide(accountMenu);
    return;
  }

  const first = (user.displayName || user.email || 'Cliente').split(' ')[0];
  accountArea.textContent = `Olá, ${first} ▾`;
  accountArea.setAttribute('aria-expanded', String(open));
  accountArea.onclick = (e)=>{ e.preventDefault(); toggle(); };

  const btnLogout  = $('btnLogout')  || $('logoutLink');
  if (btnLogout) {
    btnLogout.onclick = async (e)=>{ e.preventDefault(); await signOut(auth); };
  }
}

/* ==========================
   8) EVENTOS DO MODAL
   ========================== */
authClose?.addEventListener('click', closeModal);
authLater?.addEventListener('click', closeModal);
tabEntrar?.addEventListener('click', ()=> setTab('login'));
tabCadastrar?.addEventListener('click', ()=> setTab('signup'));

formLogin?.addEventListener('submit', async (e)=>{
  e.preventDefault(); hide(authMsg);
  const email = $('loginEmail')?.value.trim();
  const senha = $('loginSenha')?.value;
  try{
    await signInWithEmailAndPassword(auth, email, senha);
    closeModal();
  }catch(err){
    if (authMsg) authMsg.classList?.remove('info');
    authMsg.textContent = 'E-mail ou senha inválidos.';
    show(authMsg);
  }
});

formCadastro?.addEventListener('submit', async (e)=>{
  e.preventDefault(); hide(authMsg);
  const nome  = $('cadNome')?.value.trim();
  const email = $('cadEmail')?.value.trim();
  const senha = $('cadSenha')?.value;

  if ((senha||'').length < 6){
    if (authMsg) authMsg.classList?.remove('info');
    authMsg.textContent='A senha deve ter no mínimo 6 caracteres.';
    show(authMsg); return;
  }
  try{
    const cred = await createUserWithEmailAndPassword(auth, email, senha);
    if (nome) await updateProfile(cred.user, { displayName: nome });
    await ensureUserDoc(cred.user);

    try { await sendEmailVerification(cred.user); } catch {}
    emailSentNotice('Conta criada! Enviamos um e-mail para confirmar seu endereço.');
  }catch(err){
    if (authMsg) authMsg.classList?.remove('info');
    authMsg.textContent =
      (err?.code === 'auth/email-already-in-use') ? 'Este e-mail já está cadastrado.' :
      'Não foi possível cadastrar.';
    show(authMsg);
    console.error(err);
  }
});

btnGoogle?.addEventListener('click', async (e)=>{
  e.preventDefault(); hide(authMsg);
  try{
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
    await ensureUserDoc(auth.currentUser);
    closeModal();
  }catch(err){
    if (authMsg) authMsg.classList?.remove('info');
    const map = {
      'auth/unauthorized-domain': 'Domínio não autorizado no Firebase.',
      'auth/operation-not-allowed': 'Login com Google desativado.',
      'auth/popup-blocked': 'Popup bloqueado pelo navegador.',
      'auth/popup-closed-by-user': 'Você fechou a janela do login.',
      'auth/cancelled-popup-request': 'Outra tentativa de login estava em andamento.'
    };
    authMsg.textContent = map[err?.code] || `Falha ao entrar com Google: ${err?.code || 'erro desconhecido'}`;
    show(authMsg);
    console.error('Google sign-in error:', err);
  }
});

/* === Esqueci minha senha (view opcional no modal) === */
function showLoginView(){
  if (authMsg) authMsg.classList?.remove('info');
  hide(authMsg);
  setTab('login');
  hide(viewReset);
  show(formLogin);
}
function showResetView(){
  if (authMsg) authMsg.classList?.remove('info');
  hide(authMsg);
  hide(formLogin);
  show(viewReset);
  resetEmail?.focus();
}
linkForgot?.addEventListener('click', (e)=>{ e.preventDefault(); showResetView(); });
btnResetBack?.addEventListener('click', (e)=>{ e.preventDefault(); showLoginView(); });
btnResetSend?.addEventListener('click', async (e)=>{
  e.preventDefault(); hide(authMsg);
  const email = (resetEmail?.value || '').trim();
  if (!email){
    if (authMsg) authMsg.classList?.remove('info');
    authMsg.textContent = 'Informe o e-mail para redefinir a senha.';
    show(authMsg); return;
  }
  try{
    await sendPasswordResetEmail(auth, email);
    emailSentNotice('Enviamos um e-mail com o link de redefinição.');
  }catch(err){
    if (authMsg) authMsg.classList?.remove('info');
    authMsg.textContent =
      (err?.code === 'auth/user-not-found')
        ? 'Não encontramos uma conta com este e-mail.'
        : 'Não foi possível enviar o e-mail agora.';
    show(authMsg);
  }
});

/* ==========================
   9) REAÇÃO À SESSÃO
   ========================== */
onAuthStateChanged(auth, async (user)=>{
  setLocalUser(user || null);
  try { if (user) await ensureUserDoc(user); } catch {}
  renderHeader(user);

  // Evento p/ outras páginas (ex.: carrinho / perfil)
  window.dispatchEvent(new CustomEvent('auth:state', {
    detail: { emailVerified: !!(user && user.emailVerified), user: user ? {
      uid: user.uid, email: user.email || '', displayName: user.displayName || '',
      provider: (user.providerData?.[0]?.providerId) || 'password'
    } : null }
  }));

  // Legado
  document.dispatchEvent(new CustomEvent('sc:auth', { detail: { user } }));
});

/* ==========================
   10) AUTO-ABRIR MODAL NA HOME
   ========================== */
const isHome = document.body.classList.contains('home');
if (isHome) {
  setTimeout(()=>{
    if (!auth.currentUser && !getLocalUser()) openModal('login');
  }, 700);
}

/* ==========================
   11) FALLBACK “Entrar”
   ========================== */
document.addEventListener('DOMContentLoaded', () => {
  renderHeader(auth.currentUser || null);
  const btn = $('accountArea');
  if (btn) {
    btn.addEventListener('click', (e) => {
      if (!auth.currentUser) { e.preventDefault(); openModal('login'); }
    });
  }
});

/* ==========================
   12) HELPERS PÚBLICOS
   ========================== */

// Reenviar e-mail de verificação
window.resendVerificationEmail = async ()=>{
  const u = auth.currentUser;
  if (!u) return alert('Você precisa estar logado.');
  try {
    await sendEmailVerification(u);
    emailSentNotice(`Reenviamos o e-mail de verificação para ${u.email || 'seu e-mail'}.`);
  } catch (e) {
    console.error(e);
    alert('Não foi possível reenviar a verificação agora.');
  }
};

// Enviar e-mail de redefinição de senha (atajo fora do modal)
window.sendPasswordReset = async (email) => {
  if (!email) return alert('E-mail não disponível.');
  try {
    await sendPasswordResetEmail(auth, email);
    emailSentNotice('Se existir uma conta com este e-mail, enviamos um link para redefinir a senha.');
  } catch (e) {
    console.error(e);
    alert('Não foi possível enviar o link agora.');
  }
};

// Trocar senha imediatamente (Perfil)
window.changePasswordWithCurrent = async (email, currentPassword, newPassword) => {
  const u = auth.currentUser;
  if (!u) return alert('Sessão expirada.');
  try {
    const cred = EmailAuthProvider.credential(email, currentPassword);
    await reauthenticateWithCredential(u, cred);
    await updatePassword(u, newPassword);
    alert('Senha alterada com sucesso! Você precisará entrar novamente.');
    try { await signOut(auth); } catch {}
    location.href = 'index.html';
  } catch (e) {
    console.error(e);
    alert('Não foi possível alterar a senha. Confira a senha atual e tente novamente.');
  }
};

// Excluir conta (apaga doc do Firestore e o usuário)
window.deleteMyAccount = async ()=>{
  const u = auth.currentUser;
  if (!u){ alert('Você precisa estar logado.'); return; }

  if (!confirm('Tem certeza que deseja excluir sua conta? Esta ação é irreversível.')) return;

  try {
    try { await deleteDoc(doc(db, 'users', u.uid)); } catch {}
    await deleteUser(u);
    try { await signOut(auth); } catch {}
    alert('Sua conta foi excluída.');
    location.href = 'index.html';

  } catch(err){
    if (err?.code === 'auth/requires-recent-login'){
      try{
        const providerId = (u.providerData?.[0]?.providerId || '');
        if (providerId.includes('google')) {
          await reauthenticateWithPopup(u, new GoogleAuthProvider());
        } else {
          window.dispatchEvent(new CustomEvent('need-reauth'));
          return;
        }
        await deleteDoc(doc(db, 'users', u.uid)).catch(()=>{});
        await deleteUser(u);
        await signOut(auth).catch(()=>{});
        alert('Sua conta foi excluída.');
        location.href = 'index.html';
      }catch(e){
        alert('Reautenticação necessária não concluída.');
      }
    } else {
      console.error(err);
      alert('Não foi possível excluir sua conta.');
    }
  }
};

// Reautenticar com e-mail/senha e excluir (usado pela UI do Perfil)
window.reauthWithPasswordAndDelete = async (email, password)=>{
  const u = auth.currentUser;
  if (!u) return alert('Sessão expirada.');
  try{
    const cred = EmailAuthProvider.credential(email, password);
    await reauthenticateWithCredential(u, cred);
    await deleteDoc(doc(db, 'users', u.uid)).catch(()=>{});
    await deleteUser(u);
    await signOut(auth).catch(()=>{});
    alert('Sua conta foi excluída.');
    location.href = 'index.html';
  }catch(e){
    console.error(e);
    alert('Não foi possível reautenticar/excluir. Verifique a senha e tente novamente.');
  }
};

/* ==========================
   13) EXPORTS BÁSICOS
   ========================== */
export function currentUser(){ return auth.currentUser; }
export async function doSignOut(){ await signOut(auth); }

/* ==========================
   🔻 REMOVIDO: Seção 14 (Pedidos / saveOrder / getOrders)
   ========================== */
