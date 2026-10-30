import { collection, addDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { session, onSessionChange, signInWithGoogle, logout, createUserProfile } from "./auth.js";

const state = { masters: [], category: "all", district: "all", search: "", sort: "new", currentMaster: null };
const els = {
  grid: document.getElementById("mastersGrid"), cat: document.getElementById("categoryChips"), dist: document.getElementById("districtChips"),
  search: document.getElementById("searchInput"), sort: document.getElementById("sortSelect"),
  modal: document.getElementById("bookingModal"), form: document.getElementById("bookingForm"),
  mName: document.getElementById("bookingMasterName"), sName: document.getElementById("bookingServiceName"),
  mId: document.getElementById("masterId"), price: document.getElementById("servicePrice"), calc: document.getElementById("calcPrice"),
  agree: document.getElementById("agreeCheckbox"), authModal: document.getElementById("authModal"), google: document.getElementById("googleSignInBtn"),
  roleModal: document.getElementById("roleModal"), openAuth: document.getElementById("openAuthBtn"),
  userMenu: document.getElementById("userMenu"), trigger: document.getElementById("userMenuTrigger"),
  dropdown: document.getElementById("userMenuDropdown"), avatar: document.getElementById("userAvatar"),
  logout: document.getElementById("logoutBtn"), toast: document.getElementById("toast")
};

const DEF_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><rect width="400" height="500" fill="#16161f"/><text x="200" y="255" font-size="110" text-anchor="middle" dominant-baseline="middle">💅</text></svg>');

const esc = (s="") => String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const toast = (m) => { els.toast.textContent = m; els.toast.classList.add("is-visible"); setTimeout(() => els.toast.classList.remove("is-visible"), 3000); };

// Загрузка и рендер
onSnapshot(collection(db, "masters"), (snap) => {
  state.masters = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  render();
}, () => els.grid.innerHTML = `<p class="loading">Ошибка загрузки 😔</p>`);

function render() {
  let list = state.masters.filter(m => 
    (state.category === "all" || m.category === state.category) &&
    (state.district === "all" || m.district === state.district) &&
    (!state.search || (m.name||"").toLowerCase().includes(state.search.toLowerCase()))
  );

  list.sort((a, b) => {
    if (!!b.isTop - !!a.isTop) return (!!b.isTop) - (!!a.isTop);
    if (!!b.plan - !!a.plan) return (b.plan==="pro"?1:0) - (a.plan==="pro"?1:0);
    if (state.sort === "price-asc") return a.price - b.price;
    if (state.sort === "price-desc") return b.price - a.price;
    if (state.sort === "rating") return (b.ratingSum/b.ratingCount || 5) - (a.ratingSum/a.ratingCount || 5);
    return (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0);
  });

  els.grid.innerHTML = list.length ? list.map(m => `
    <article class="master-card">
      ${m.isTop ? '<span class="badge badge--top">Реклама</span>' : m.plan === "pro" ? '<span class="badge badge--pro">PRO</span>' : ''}
      <img class="master-card__photo" src="${m.photoUrl || DEF_IMG}" onerror="this.src='${DEF_IMG}'" alt="${esc(m.name)}" loading="lazy" />
      <div class="master-card__body">
        <div class="master-card__head">
          <h3 class="master-card__name">${esc(m.name)}</h3>
          <span class="master-card__rating">★ ${(m.ratingSum/m.ratingCount||5).toFixed(1)}</span>
        </div>
        <p class="master-card__meta">${esc(m.category)} · <b>${esc(m.district)}</b></p>
        <p class="master-card__price">${esc(m.serviceName)} <small>· ${m.price} ₽</small></p>
        <button class="btn btn--primary" data-book="${m.id}">Записаться</button>
      </div>
    </article>`).join("") : `<p class="loading">Никого не нашлось 🌸</p>`;
}

// Фильтры
els.search.oninput = (e) => { state.search = e.target.value; render(); };
els.sort.onchange = (e) => { state.sort = e.target.value; render(); };
[els.cat, els.dist].forEach(c => c.onclick = (e) => {
  if (!e.target.classList.contains("chip")) return;
  c.querySelectorAll(".chip").forEach(b => b.classList.remove("chip--active"));
  e.target.classList.add("chip--active");
  state[c.id === "categoryChips" ? "category" : "district"] = e.target.dataset[c.id === "categoryChips" ? "category" : "district"];
  render();
});

// Модалка брони
els.grid.onclick = (e) => {
  const btn = e.target.closest("[data-book]"); if (!btn) return;
  const m = state.masters.find(x => x.id === btn.dataset.book);
  state.currentMaster = m;
  els.mName.textContent = `Заявка к ${m.name}`;
  els.sName.textContent = `${m.serviceName} · ${m.district}`;
  els.mId.value = m.id; els.price.value = m.price; els.calc.textContent = m.price;
  els.modal.classList.add("is-open"); document.body.style.overflow = "hidden";
};
els.modal.onclick = (e) => { if (e.target.hasAttribute("data-close-modal")) closeBook(); };
function closeBook() { els.modal.classList.remove("is-open"); els.form.reset(); document.body.style.overflow = ""; }

els.form.onsubmit = async (e) => {
  e.preventDefault();
  if (!els.agree.checked) return toast("Подтвердите оферту");
  const phone = document.getElementById("clientPhone").value.replace(/\D/g, "");
  if (phone.length < 10) return toast("Неверный телефон");

  try {
    await addDoc(collection(db, "bookings"), {
      masterId: state.currentMaster.id, masterName: state.currentMaster.name,
      serviceName: state.currentMaster.serviceName, price: Number(state.currentMaster.price),
      clientName: document.getElementById("clientName").value.trim(),
      clientPhone: phone, date: document.getElementById("bookingDate").value, time: document.getElementById("bookingTime").value,
      status: "pending", createdAt: serverTimestamp(), clientUid: session.user?.uid || null
    });
    toast("Заявка отправлена ✨"); closeBook();
  } catch { toast("Ошибка отправки"); }
};

// Авторизация и меню
els.openAuth?.addEventListener("click", () => els.authModal.classList.add("is-open"));
els.authModal.onclick = (e) => { if (e.target.hasAttribute("data-close-auth")) els.authModal.classList.remove("is-open"); };
els.google.onclick = async () => { try { await signInWithGoogle(); els.authModal.classList.remove("is-open"); } catch { toast("Ошибка входа"); } };

document.querySelectorAll("[data-role]").forEach(b => b.onclick = async () => {
  await createUserProfile(session.user, b.dataset.role);
  els.roleModal.classList.remove("is-open"); toast("Добро пожаловать!");
});

els.trigger?.onclick = (e) => { e.stopPropagation(); els.dropdown.hidden = !els.dropdown.hidden; };
document.onclick = (e) => { if (els.userMenu && !els.userMenu.contains(e.target)) els.dropdown.hidden = true; };
els.logout?.onclick = async () => { await logout(); els.dropdown.hidden = true; toast("Выход"); };

onSessionChange(() => {
  const isAuth = !!session.user;
  if (els.openAuth) els.openAuth.hidden = isAuth;
  if (els.userMenu) els.userMenu.hidden = !isAuth;
  if (isAuth) {
    els.avatar.src = session.user.photoURL?.includes('googleusercontent') ? DEF_IMG : (session.user.photoURL || DEF_IMG);
    if (!session.profile) els.roleModal.classList.add("is-open");
  }
});
