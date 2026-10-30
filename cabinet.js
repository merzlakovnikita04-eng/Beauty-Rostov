import { collection, query, where, doc, setDoc, getDoc, updateDoc, deleteDoc, onSnapshot, addDoc, increment, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { session, onSessionChange, logout, ensureMasterSubscription } from "./auth.js";

const el = (id) => document.getElementById(id);
const els = {
  loading: el("cabinetLoading"), clientV: el("clientView"), masterV: el("masterView"),
  clientB: el("clientBookings"), masterB: el("masterBookings"), form: el("masterProfileForm"),
  delBtn: el("deleteProfileBtn"), agree: el("masterAgreeCheckbox"), subBanner: el("subBanner"),
  subTitle: el("subTitle"), subDesc: el("subDesc"), photoIn: el("photoInput"), photoPrev: el("photoPreview"),
  worksIn: el("worksInput"), worksGrid: el("worksGrid"), toast: el("toast"), menu: el("userMenu"),
  dropdown: el("userMenuDropdown"), avatar: el("userAvatar"), logoutBtn: el("logoutBtn")
};

const DEF_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><rect width="400" height="500" fill="#16161f"/><text x="200" y="255" font-size="110" text-anchor="middle" dominant-baseline="middle">💅</text></svg>');
let photoUrl = "", works = [], unsub = null;
const esc = (s="") => String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const toast = (m) => { els.toast.textContent = m; els.toast.classList.add("is-visible"); setTimeout(() => els.toast.classList.remove("is-visible"), 3000); };

// Инициализация
onSessionChange(async () => {
  if (!session.ready) return;
  if (!session.user) return location.replace("index.html");
  
  els.avatar.src = session.user.photoURL?.includes('googleusercontent') ? DEF_IMG : (session.user.photoURL || DEF_IMG);
  els.menu.hidden = false;
  els.loading.hidden = true;

  if (session.profile?.role === "master") {
    els.masterV.hidden = false;
    await ensureMasterSubscription(session.user.uid);
    await renderBanner();
    await loadProfile();
    subscribe(where("masterId", "==", session.user.uid), els.masterB, renderMasterB);
  } else {
    els.clientV.hidden = false;
    subscribe(where("clientUid", "==", session.user.uid), els.clientB, renderClientB);
  }
});

async function renderBanner() {
  const status = session.profile?.subscriptionStatus;
  els.subBanner.hidden = false;
  els.subTitle.textContent = status === "free" ? "Бесплатный доступ активирован" : "Заявка в очереди";
  els.subDesc.textContent = status === "free" ? "Вы в числе первых 50 мастеров." : "Мы свяжемся с вами.";
}

// Загрузка и сохранение профиля
async function loadProfile() {
  const snap = await getDoc(doc(db, "masters", session.user.uid));
  if (!snap.exists()) return;
  const m = snap.data();
  el("mName").value = m.name || ""; el("mCategory").value = m.category || "Ногти";
  el("mDistrict").value = m.district || "Кировский"; el("mService").value = m.serviceName || "";
  el("mPrice").value = m.price || ""; els.delBtn.hidden = false; els.agree.checked = true;
  if (m.photoUrl) { photoUrl = m.photoUrl; els.photoPrev.innerHTML = `<img src="${m.photoUrl}">`; }
  works = m.works || []; renderWorks();
}

els.form.onsubmit = async (e) => {
  e.preventDefault();
  if (!els.agree.checked) return toast("Подтвердите оферту");
  const price = Number(el("mPrice").value);
  if (price < 100 || price > 1000000) return toast("Цена от 100 до 1 млн");

  const btn = els.form.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = "Сохраняем...";
  try {
    await setDoc(doc(db, "masters", session.user.uid), {
      name: el("mName").value.trim(), category: el("mCategory").value, district: el("mDistrict").value,
      serviceName: el("mService").value.trim(), price, photoUrl, works, ownerUid: session.user.uid,
      updatedAt: serverTimestamp()
    }, { merge: true });
    els.delBtn.hidden = false; toast("Карточка сохранена ✨");
  } catch { toast("Ошибка сохранения"); } finally { btn.disabled = false; btn.textContent = "Сохранить карточку"; }
};

els.delBtn.onclick = async () => {
  if (!confirm("Удалить карточку?")) return;
  await deleteDoc(doc(db, "masters", session.user.uid));
  els.form.reset(); els.photoPrev.innerHTML = "💅"; photoUrl = ""; works = []; renderWorks();
  els.delBtn.hidden = true; toast("Удалено");
};

// Загрузка фото (сжатие)
const compress = (file) => new Promise((res, rej) => {
  if (file.size > 15e6) return rej("Файл > 15 МБ");
  const r = new FileReader();
  r.onload = (e) => { const i = new Image(); i.onload = () => {
    const c = document.createElement("canvas"), s = Math.min(1, 1200/i.width);
    c.width = i.width*s; c.height = i.height*s;
    c.getContext("2d").drawImage(i, 0, 0, c.width, c.height);
    c.toBlob(b => b ? res(b) : rej("Ошибка сжатия"), "image/jpeg", 0.75);
  }; i.src = e.target.result; };
  r.readAsDataURL(file);
});

async function upload(blob, id) {
  const fd = new FormData();
  fd.append("file", blob); fd.append("upload_preset", "beauty_unsigned");
  fd.append("folder", "masters"); fd.append("public_id", id);
  const res = await fetch("https://api.cloudinary.com/v1_1/whrxpqma/image/upload", { method: "POST", body: fd });
  return (await res.json()).secure_url;
}

els.photoIn.onchange = async (e) => {
  const f = e.target.files?.[0]; if (!f) return;
  try {
    const blob = await compress(f); const url = await upload(blob, `avatar-${session.user.uid}`);
    photoUrl = url; els.photoPrev.innerHTML = `<img src="${url}">`;
    await setDoc(doc(db, "masters", session.user.uid), { photoUrl: url }, { merge: true });
    toast("Загружено ✨");
  } catch (err) { toast(err.message || "Ошибка"); }
};

els.worksIn.onchange = async (e) => {
  const files = Array.from(e.target.files || []).slice(0, 6 - works.length);
  if (!files.length) return toast("Лимит 6 фото");
  for (const f of files) {
    try {
      const blob = await compress(f); const url = await upload(blob, `work-${session.user.uid}-${crypto.randomUUID()}`);
      works.push(url); renderWorks();
      await setDoc(doc(db, "masters", session.user.uid), { works }, { merge: true });
    } catch { toast("Ошибка фото"); }
  }
};

function renderWorks() {
  els.worksGrid.innerHTML = works.length ? works.map((u, i) => `
    <div class="work-item"><img src="${u}"><button onclick="removeWork(${i})">×</button></div>
  `).join("") : "Пока нет работ";
}
window.removeWork = async (i) => {
  works.splice(i, 1); renderWorks();
  await setDoc(doc(db, "masters", session.user.uid), { works }, { merge: true });
};

// Брони
function subscribe(q, target, renderFn) {
  if (unsub) unsub();
  unsub = onSnapshot(query(collection(db, "bookings"), q), (s) => renderFn(s, target), () => target.innerHTML = "Ошибка загрузки");
}

const badge = (s) => `<span class="booking-item__status status--${s}">${s}</span>`;

function renderClientB(snap, target) {
  if (snap.empty) return target.innerHTML = "Заявок нет 🌸";
  target.innerHTML = snap.docs.map(d => {
    const b = d.data();
    return `<div class="booking-item">${badge(b.status)}
      <b>${esc(b.masterName)}</b> · ${esc(b.serviceName)} <br> ${b.date} ${b.time} · ${b.price} ₽
      ${b.status === "paid" && !b.hasReview ? `<button class="btn btn--primary" onclick="openReview('${b.masterId}', '${d.id}')">Отзыв</button>` : ""}
    </div>`;
  }).join("");
}

function renderMasterB(snap, target) {
  if (snap.empty) return target.innerHTML = "Заявок нет";
  target.innerHTML = snap.docs.map(d => {
    const b = d.data();
    return `<div class="booking-item">${badge(b.status)}
      <b>${esc(b.clientName)}</b> · ${esc(b.clientPhone)} <br> ${b.date} ${b.time} · ${b.price} ₽
      ${b.status === "pending" ? `<button class="btn btn--confirm" onclick="setStatus('${d.id}', 'confirmed')">Подтвердить</button>` : ""}
      ${b.status === "confirmed" ? `<button class="btn btn--confirm" onclick="setStatus('${d.id}', 'paid')">Оплачено</button>` : ""}
    </div>`;
  }).join("");
}

window.setStatus = async (id, status) => {
  await updateDoc(doc(db, "bookings", id), { status, statusUpdatedAt: serverTimestamp() });
  toast("Обновлено");
};

window.openReview = (mid, bid) => {
  const r = prompt("Оценка от 1 до 5:"), t = prompt("Текст отзыва:");
  if (!r || !t) return;
  runTransaction(db, async (tx) => {
    const b = await tx.get(doc(db, "bookings", bid));
    if (b.data().hasReview) throw "Уже есть отзыв";
    const m = await tx.get(doc(db, "masters", mid));
    tx.set(doc(collection(db, "reviews")), { masterId: mid, bookingId: bid, rating: +r, text: t, clientUid: session.user.uid, createdAt: serverTimestamp() });
    tx.update(doc(db, "bookings", bid), { hasReview: true });
    tx.update(doc(db, "masters", mid), { ratingSum: increment(+r), ratingCount: increment(1) });
  }).then(() => toast("Спасибо за отзыв!")).catch(e => toast(e));
};

els.logoutBtn.onclick = async () => { if (unsub) unsub(); await logout(); location.replace("index.html"); };
