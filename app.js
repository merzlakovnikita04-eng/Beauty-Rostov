import {
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { db } from "./firebase-config.js";
import {
  session,
  onSessionChange,
  signInWithGoogle,
  logout,
  createUserProfile
} from "./auth.js";

const state = {
  masters: [],
  category: "all",
  district: "all",
  search: "",
  sort: "new",
  currentMaster: null
};

const els = {
  mastersGrid:   document.getElementById("mastersGrid"),
  categoryChips: document.getElementById("categoryChips"),
  districtChips: document.getElementById("districtChips"),

  searchInput:   document.getElementById("searchInput"),
  sortSelect:    document.getElementById("sortSelect"),

  bookingModal:  document.getElementById("bookingModal"),
  form:          document.getElementById("bookingForm"),
  masterName:    document.getElementById("bookingMasterName"),
  serviceName:   document.getElementById("bookingServiceName"),
  masterId:      document.getElementById("masterId"),
  servicePrice:  document.getElementById("servicePrice"),
  calcPrice:     document.getElementById("calcPrice"),
  calcFee:       document.getElementById("calcFee"),

  agreeCheckbox: document.getElementById("agreeCheckbox"),

  authModal:     document.getElementById("authModal"),
  googleSignInBtn: document.getElementById("googleSignInBtn"),

  roleModal:     document.getElementById("roleModal"),
  roleCards:     document.querySelectorAll("[data-role]"),

  openAuthBtn:   document.getElementById("openAuthBtn"),
  userMenu:      document.getElementById("userMenu"),
  userMenuTrigger: document.getElementById("userMenuTrigger"),
  userMenuDropdown: document.getElementById("userMenuDropdown"),
  userAvatar:    document.getElementById("userAvatar"),
  logoutBtn:     document.getElementById("logoutBtn"),

  toast:         document.getElementById("toast"),
};

const DEFAULT_PHOTO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#ff5cc7"/><stop offset="1" stop-color="#7c5cff"/>' +
      '</linearGradient></defs>' +
      '<rect width="400" height="500" fill="#16161f"/>' +
      '<circle cx="200" cy="220" r="70" fill="url(#g)" opacity="0.25"/>' +
      '<text x="200" y="255" font-size="110" text-anchor="middle" dominant-baseline="middle">💅</text>' +
    '</svg>'
  );

/* ============ РЕАЛЬНОЕ ВРЕМЯ ============ */
function loadMasters() {
  onSnapshot(
    collection(db, "masters"),
    (snapshot) => {
      state.masters = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      renderMasters();
    },
    (err) => {
      console.error("Ошибка потока мастеров:", err);
      els.mastersGrid.innerHTML =
        `<p class="loading">Не удалось загрузить мастеров 😔</p>`;
    }
  );
}

function getFilteredMasters() {
  const q = state.search.trim().toLowerCase();

  let list = state.masters.filter(m => {
    const okCategory = state.category === "all" || m.category === state.category;
    const okDistrict = state.district === "all" || m.district === state.district;
    const okSearch = !q || (m.name || "").toLowerCase().includes(q);
    return okCategory && okDistrict && okSearch;
  });

  const s = state.sort;
  if (s === "rating") {
    list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  } else if (s === "price-asc") {
    list.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
  } else if (s === "price-desc") {
    list.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
  } else if (s === "district") {
    list.sort((a, b) => (a.district || "").localeCompare(b.district || "", "ru"));
  } else {
    list.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
  }

  return list;
}

function renderMasters() {
  const list = getFilteredMasters();

  if (list.length === 0) {
    els.mastersGrid.innerHTML =
      `<p class="loading">По вашему фильтру никого не нашлось 🌸</p>`;
    return;
  }

  els.mastersGrid.innerHTML = list.map(m => {
    const photo = (m.photoUrl && m.photoUrl.trim()) ? m.photoUrl : DEFAULT_PHOTO;
    const works = Array.isArray(m.works) ? m.works.filter(Boolean) : [];

    const worksHTML = works.length > 0
      ? `<div class="master-card__works">
          ${works.map((url, i) => `
            <button type="button" class="master-card__work" aria-label="Работа ${i + 1}">
              <img src="${url}" alt="Работа ${i + 1}" loading="lazy" />
            </button>
          `).join("")}
        </div>`
      : "";

    return `
      <article class="master-card">
        <img
          class="master-card__photo"
          src="${photo}"
          onerror="this.onerror=null; this.src='${DEFAULT_PHOTO}'"
          alt="${escapeHtml(m.name)}"
          loading="lazy"
        />
        <div class="master-card__body">
          <div class="master-card__head">
            <h3 class="master-card__name">${escapeHtml(m.name)}</h3>
            <span class="master-card__rating">★ ${m.rating?.toFixed(1) || "—"}</span>
          </div>
          <p class="master-card__meta">
            ${escapeHtml(m.category)} · <b>${escapeHtml(m.district)} район</b>
          </p>
          <p class="master-card__price">
            ${escapeHtml(m.serviceName || "Услуга")}
            <small>· ${m.price} ₽</small>
          </p>
          ${worksHTML}
          <button class="btn btn--primary" data-book-id="${m.id}">Записаться</button>
        </div>
      </article>
    `;
  }).join("");
}

function bindChips(container, key) {
  container.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    container.querySelectorAll(".chip").forEach(c => c.classList.remove("chip--active"));
    chip.classList.add("chip--active");
    state[key] = chip.dataset[key];
    renderMasters();
  });
}

els.searchInput.addEventListener("input", (e) => {
  state.search = e.target.value;
  renderMasters();
});

els.sortSelect.addEventListener("change", (e) => {
  state.sort = e.target.value;
  renderMasters();
});

/* ============ МОДАЛКА БРОНИРОВАНИЯ ============ */
function openBookingModal(masterId) {
  const master = state.masters.find(m => m.id === masterId);
  if (!master) return;

  state.currentMaster = master;
  els.masterName.textContent  = `Заявка к ${master.name}`;
  els.serviceName.textContent = `${master.serviceName || master.category} · ${master.district} район`;
  els.masterId.value     = master.id;
  els.servicePrice.value = master.price;

  updateCalc(master.price);

  els.bookingModal.classList.add("is-open");
  els.bookingModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function updateCalc(price) {
  const fee = Math.round(price * 0.05);
  els.calcPrice.textContent = price;
  els.calcFee.textContent   = fee;
}

function closeBookingModal() {
  els.bookingModal.classList.remove("is-open");
  els.bookingModal.setAttribute("aria-hidden", "true");
  els.form.reset();
  state.currentMaster = null;
  document.body.style.overflow = "";
}

async function handleBookingSubmit(e) {
  e.preventDefault();
  const master = state.currentMaster;
  if (!master) return;

  /* Проверка согласия с офертой */
  if (!els.agreeCheckbox.checked) {
    showToast("Подтвердите согласие с офертой и политикой");
    return;
  }

  const price = Number(master.price);
  const fee   = Math.round(price * 0.05);

  const booking = {
    masterId:    master.id,
    masterName:  master.name,
    serviceName: master.serviceName || master.category,
    price,
    serviceFee:  fee,
    totalOnline: fee,
    clientName:  document.getElementById("clientName").value.trim(),
    clientPhone: document.getElementById("clientPhone").value.trim(),
    date:        document.getElementById("bookingDate").value,
    time:        document.getElementById("bookingTime").value,
    status:      "pending",
    createdAt:   serverTimestamp(),
    clientUid:   session.user?.uid || null,
    agreeOferta: true,
    agreeAt:     serverTimestamp()
  };

  if (!booking.clientName || !booking.clientPhone || !booking.date || !booking.time) {
    showToast("Заполните все поля 🌸");
    return;
  }

  const btn = document.getElementById("confirmBookingBtn");
  btn.disabled = true;
  btn.textContent = "Отправляем…";

  try {
    const docRef = await addDoc(collection(db, "bookings"), booking);
    console.log("Заявка создана с ID:", docRef.id);
    showToast("Заявка отправлена! Ждите подтверждения мастера ✨");
    closeBookingModal();
  } catch (err) {
    console.error("Ошибка создания заявки:", err);
    showToast("Не удалось отправить заявку.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Отправить заявку";
  }
}

function openAuthModal() {
  els.authModal.classList.add("is-open");
  els.authModal.setAttribute("aria-hidden", "false");
}
function closeAuthModal() {
  els.authModal.classList.remove("is-open");
  els.authModal.setAttribute("aria-hidden", "true");
}

async function handleGoogleSignIn() {
  try {
    els.googleSignInBtn.disabled = true;
    await signInWithGoogle();
    closeAuthModal();
  } catch (err) {
    console.error("Ошибка входа:", err.code, err.message);
    let msg = "Не удалось войти.";
    if (err.code === "auth/unauthorized-domain") msg = "Домен не разрешён в Firebase.";
    else if (err.code === "auth/popup-blocked") msg = "Разреши всплывающие окна.";
    else if (err.code === "auth/popup-closed-by-user") msg = "Окно закрыто.";
    showToast(msg);
  } finally {
    els.googleSignInBtn.disabled = false;
  }
}

function openRoleModal() {
  els.roleModal.classList.add("is-open");
  els.roleModal.setAttribute("aria-hidden", "false");
}
function closeRoleModal() {
  els.roleModal.classList.remove("is-open");
  els.roleModal.setAttribute("aria-hidden", "true");
}

async function handleRolePick(role) {
  if (!session.user) return;
  try {
    await createUserProfile(session.user, role);
    closeRoleModal();
    showToast(role === "master" ? "Добро пожаловать, мастер ✨" : "Добро пожаловать 🌸");
  } catch (err) {
    console.error("Ошибка сохранения роли:", err);
    showToast("Не удалось сохранить роль.");
  }
}

function renderHeader() {
  if (!session.ready) {
    els.openAuthBtn.hidden = true;
    els.userMenu.hidden = true;
    return;
  }

  const loggedIn = !!session.user;
  els.openAuthBtn.hidden = loggedIn;
  els.userMenu.hidden = !loggedIn;

  if (loggedIn) {
    const avatar = session.user.photoURL || session.profile?.photoUrl;
    if (avatar) els.userAvatar.src = avatar;
    els.userAvatar.alt = session.user.displayName || "Профиль";
    if (!session.profile) openRoleModal();
  } else {
    els.userMenuDropdown.hidden = true;
  }
}

function openLightbox(src) {
  let lb = document.getElementById("lightbox");
  if (!lb) {
    lb = document.createElement("div");
    lb.id = "lightbox";
    lb.className = "lightbox";
    lb.innerHTML = `<img class="lightbox__img" alt="" />`;
    lb.addEventListener("click", () => {
      lb.classList.remove("is-open");
      document.body.style.overflow = "";
    });
    document.body.appendChild(lb);
  }
  lb.querySelector(".lightbox__img").src = src;
  lb.classList.add("is-open");
  document.body.style.overflow = "hidden";
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".master-card__work");
  if (!btn) return;
  const img = btn.querySelector("img");
  if (img) openLightbox(img.src);
});

let toastTimer = null;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove("is-visible");
  }, 4000);
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

els.mastersGrid.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-book-id]");
  if (!btn) return;
  openBookingModal(btn.dataset.bookId);
});

els.bookingModal.addEventListener("click", (e) => {
  if (e.target.hasAttribute("data-close-modal")) closeBookingModal();
});

els.authModal.addEventListener("click", (e) => {
  if (e.target.hasAttribute("data-close-auth")) closeAuthModal();
});

els.openAuthBtn.addEventListener("click", openAuthModal);
els.googleSignInBtn.addEventListener("click", handleGoogleSignIn);

els.roleCards.forEach(card => {
  card.addEventListener("click", () => handleRolePick(card.dataset.role));
});

els.userMenuTrigger.addEventListener("click", () => {
  els.userMenuDropdown.hidden = !els.userMenuDropdown.hidden;
});

document.addEventListener("click", (e) => {
  if (!els.userMenu.contains(e.target)) els.userMenuDropdown.hidden = true;
});

els.logoutBtn.addEventListener("click", async () => {
  await logout();
  els.userMenuDropdown.hidden = true;
  showToast("Вы вышли из аккаунта");
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (els.bookingModal.classList.contains("is-open")) closeBookingModal();
  if (els.authModal.classList.contains("is-open"))    closeAuthModal();
  const lb = document.getElementById("lightbox");
  if (lb) lb.classList.remove("is-open");
});

els.form.addEventListener("submit", handleBookingSubmit);

bindChips(els.categoryChips, "category");
bindChips(els.districtChips, "district");

onSessionChange(renderHeader);
loadMasters();
