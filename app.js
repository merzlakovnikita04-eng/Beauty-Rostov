import {
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
  doc,
  getDoc
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
  mastersGrid:      document.getElementById("mastersGrid"),
  categoryChips:    document.getElementById("categoryChips"),
  districtChips:    document.getElementById("districtChips"),
  searchInput:      document.getElementById("searchInput"),
  sortSelect:       document.getElementById("sortSelect"),

  bookingModal:     document.getElementById("bookingModal"),
  form:             document.getElementById("bookingForm"),
  masterName:       document.getElementById("bookingMasterName"),
  serviceName:      document.getElementById("bookingServiceName"),
  masterId:         document.getElementById("masterId"),
  servicePrice:     document.getElementById("servicePrice"),
  calcPrice:        document.getElementById("calcPrice"),

  agreeCheckbox:    document.getElementById("agreeCheckbox"),

  authModal:        document.getElementById("authModal"),
  googleSignInBtn:  document.getElementById("googleSignInBtn"),

  roleModal:        document.getElementById("roleModal"),
  roleCards:        document.querySelectorAll("[data-role]"),

  openAuthBtn:      document.getElementById("openAuthBtn"),
  userMenu:         document.getElementById("userMenu"),
  userMenuTrigger:  document.getElementById("userMenuTrigger"),
  userMenuDropdown: document.getElementById("userMenuDropdown"),
  userAvatar:       document.getElementById("userAvatar"),
  logoutBtn:        document.getElementById("logoutBtn"),

  toast:            document.getElementById("toast"),
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

function safeUrl(url) {
  if (!url) return "";
  return /^(https:\/\/|data:image\/)/.test(url) ? url : "";
}

/* ============ ЗАГРУЗКА МАСТЕРОВ ============ */
function loadMasters() {
  onSnapshot(
    collection(db, "masters"),
    (snapshot) => {
      state.masters = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      renderMasters();
    },
    (err) => {
      console.error("Ошибка потока мастеров:", err);
      els.mastersGrid.innerHTML =
        `<p class="loading">Не удалось загрузить мастеров 😔</p>`;
    }
  );
}

/* ============ ФИЛЬТРЫ И СОРТИРОВКА ============ */
function getFilteredMasters() {
  const q = state.search.trim().toLowerCase();

  let list = state.masters.filter(m => {
    const okCategory = state.category === "all" || m.category === state.category;
    const okDistrict = state.district === "all" || m.district === state.district;
    const okSearch = !q || (m.name || "").toLowerCase().includes(q);
    return okCategory && okDistrict && okSearch;
  });

  list.sort((a, b) => {
    const aIsTop = a.isTop ? 1 : 0;
    const bIsTop = b.isTop ? 1 : 0;
    if (aIsTop !== bIsTop) return bIsTop - aIsTop;

    const aIsPro = a.plan === "pro" ? 1 : 0;
    const bIsPro = b.plan === "pro" ? 1 : 0;
    if (aIsPro !== bIsPro) return bIsPro - aIsPro;

    switch (state.sort) {
      case "price-asc":
        return (Number(a.price) || 0) - (Number(b.price) || 0);
      case "price-desc":
        return (Number(b.price) || 0) - (Number(a.price) || 0);
      case "rating": {
        const ra = a.ratingCount > 0 ? a.ratingSum / a.ratingCount : (Number(a.rating) || 5);
        const rb = b.ratingCount > 0 ? b.ratingSum / b.ratingCount : (Number(b.rating) || 5);
        return rb - ra;
      }
      case "district": {
        return String(a.district || "").localeCompare(String(b.district || ""), "ru");
      }
      case "new":
      default:
        return (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0);
    }
  });

  return list;
}

/* ============ РЕНДЕР КАТАЛОГА ============ */
function renderMasters() {
  const list = getFilteredMasters();

  if (list.length === 0) {
    els.mastersGrid.innerHTML =
      `<p class="loading">По вашему фильтру никого не нашлось 🌸</p>`;
    return;
  }

  els.mastersGrid.innerHTML = list.map(m => {
    const photo = safeUrl(m.photoUrl) || DEFAULT_PHOTO;
    const works = Array.isArray(m.works) ? m.works.map(safeUrl).filter(Boolean) : [];

    const avgRating = m.ratingCount > 0
      ? (m.ratingSum / m.ratingCount).toFixed(1)
      : (m.rating || "5.0");
    const reviewCount = m.ratingCount || 0;

    const worksHTML = works.length > 0
      ? `<div class="master-card__works">
          ${works.map((url, i) => `
            <button type="button" class="master-card__work" aria-label="Работа ${i + 1}">
              <img src="${url}" alt="Работа ${i + 1}" loading="lazy" />
            </button>
          `).join("")}
        </div>`
      : "";

    let badges = "";
    if (m.isTop) badges += `<span class="badge badge--top">Реклама</span>`;
    else if (m.plan === "pro") badges += `<span class="badge badge--pro">PRO</span>`;

    return `
      <article class="master-card">
        ${badges}
        <img
          class="master-card__photo"
          src="${photo}"
          onerror="this.onerror=null; this.src='${DEFAULT_PHOTO}'"
          alt="${escapeHtml(m.name || "Мастер")}"
          loading="lazy"
        />
        <div class="master-card__body">
          <div class="master-card__head">
            <h3 class="master-card__name">${escapeHtml(m.name || "")}</h3>
            <span class="master-card__rating">★ ${avgRating} (${reviewCount})</span>
          </div>
          <p class="master-card__meta">
            ${escapeHtml(m.category || "")} · <b>${escapeHtml(m.district || "")} район</b>
          </p>
          <p class="master-card__price">
            ${escapeHtml(m.serviceName || "Услуга")}
            <small>· ${Number(m.price) || 0} ₽</small>
          </p>
          ${worksHTML}
          <button class="btn btn--primary" data-book-id="${escapeHtml(m.id)}">Записаться</button>
        </div>
      </article>
    `;
  }).join("");
}

/* ============ ЧИПЫ ============ */
function bindChips(container, key) {
  if (!container) return;
  container.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    container.querySelectorAll(".chip").forEach(c => c.classList.remove("chip--active"));
    chip.classList.add("chip--active");
    state[key] = chip.dataset[key];
    renderMasters();
  });
}

els.searchInput?.addEventListener("input", (e) => {
  state.search = e.target.value;
  renderMasters();
});

els.sortSelect?.addEventListener("change", (e) => {
  state.sort = e.target.value;
  renderMasters();
});

/* ============ БРОНИРОВАНИЕ ============ */
function openBookingModal(masterId) {
  const master = state.masters.find(m => m.id === masterId);
  if (!master) return;

  state.currentMaster = master;
  els.masterName.textContent  = `Заявка к ${master.name || "мастеру"}`;
  els.serviceName.textContent = `${master.serviceName || master.category || ""} · ${master.district || ""} район`;
  els.masterId.value     = master.id;
  els.servicePrice.value = Number(master.price) || 0;

  els.calcPrice.textContent = Number(master.price) || 0;

  const dateInput = document.getElementById("bookingDate");
  if (dateInput) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    dateInput.min = `${yyyy}-${mm}-${dd}`;
  }

  els.bookingModal.classList.add("is-open");
  els.bookingModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeBookingModal() {
  els.bookingModal.classList.remove("is-open");
  els.bookingModal.setAttribute("aria-hidden", "true");
  els.form.reset();
  state.currentMaster = null;
  document.body.style.overflow = "";
}

function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) return digits;
  if (digits.length === 10) return "7" + digits;
  return null;
}

async function handleBookingSubmit(e) {
  e.preventDefault();
  const master = state.currentMaster;
  if (!master) return;

  if (!els.agreeCheckbox.checked) {
    showToast("Подтвердите согласие с офертой и политикой");
    return;
  }

  const clientName = document.getElementById("clientName").value.trim();
  const clientPhoneRaw = document.getElementById("clientPhone").value.trim();
  const date = document.getElementById("bookingDate").value;
  const time = document.getElementById("bookingTime").value;

  if (!clientName || !clientPhoneRaw || !date || !time) {
    showToast("Заполните все поля 🌸");
    return;
  }

  const phone = normalizePhone(clientPhoneRaw);
  if (!phone) {
    showToast("Введите корректный номер телефона");
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const chosen = new Date(date + "T00:00:00");
  if (isNaN(chosen.getTime()) || chosen < today) {
    showToast("Дата не может быть в прошлом");
    return;
  }

  const booking = {
    masterId:    master.id,
    masterName:  master.name || "",
    serviceName: master.serviceName || master.category || "",
    price:       Number(master.price) || 0,
    clientName,
    clientPhone: phone,
    date,
    time,
    status:      "pending",
    createdAt:   serverTimestamp(),
    clientUid:   session.user?.uid || null,
    agreeOferta: true,
    agreeAt:     serverTimestamp()
  };

  const btn = document.getElementById("confirmBookingBtn");
  btn.disabled = true;
  btn.textContent = "Отправляем…";

  try {
    await addDoc(collection(db, "bookings"), booking);
    showToast("Заявка отправлена! Мастер свяжется с вами ✨");
    closeBookingModal();
  } catch (err) {
    console.error("Ошибка создания заявки:", err);
    showToast("Не удалось отправить заявку.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Отправить заявку";
  }
}

/* ============ АВТОРИЗАЦИЯ ============ */
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
    alert("ОШИБКА ВХОДА:\nКод: " + err.code + "\nТекст: " + err.message);
  } finally {
    els.googleSignInBtn.disabled = false;
  }
}

let roleModalShown = false;
function openRoleModal() {
  if (roleModalShown) return;
  roleModalShown = true;
  els.roleModal.classList.add("is-open");
  els.roleModal.setAttribute("aria-hidden", "false");
}

function closeRoleModal() {
  els.roleModal.classList.remove("is-open");
  els.roleModal.setAttribute("aria-hidden", "true");
  roleModalShown = false;
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

/* ============ ШАПКА ============ */
function renderHeader() {
  if (!session.ready) {
    if (els.openAuthBtn) els.openAuthBtn.hidden = true;
    if (els.userMenu) els.userMenu.hidden = true;
    return;
  }

  const loggedIn = !!session.user;
  if (els.openAuthBtn) els.openAuthBtn.hidden = loggedIn;
  if (els.userMenu) els.userMenu.hidden = !loggedIn;

  if (loggedIn) {
    let avatar = session.user.photoURL || session.profile?.photoUrl;
    
    // ЖЕСТКАЯ ПРОВЕРКА: если фото содержит 'googleusercontent' (стандартная заглушка Google), заменяем на нашу
    if (!avatar || avatar.includes('googleusercontent.com/a/')) {
      avatar = DEFAULT_PHOTO;
    }

    if (els.userAvatar) {
      els.userAvatar.src = avatar;
      els.userAvatar.alt = session.user.displayName || "Профиль";
      els.userAvatar.onerror = () => {
        els.userAvatar.src = DEFAULT_PHOTO;
        els.userAvatar.onerror = null;
      };
    }
    
    if (!session.profile) openRoleModal();
  } else {
    if (els.userMenuDropdown) els.userMenuDropdown.hidden = true;
  }
}

/* ============ LIGHTBOX ============ */
function openLightbox(src) {
  if (!src) return;
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

/* ============ ОБРАБОТЧИКИ ============ */
if (els.openAuthBtn) {
  els.openAuthBtn.onclick = openAuthModal;
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

if (els.googleSignInBtn) {
  els.googleSignInBtn.onclick = handleGoogleSignIn;
}

els.roleCards.forEach(card => {
  card.addEventListener("click", () => handleRolePick(card.dataset.role));
});

if (els.userMenuTrigger) {
  els.userMenuTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    els.userMenuDropdown.hidden = !els.userMenuDropdown.hidden;
  });
}

document.addEventListener("click", (e) => {
  if (els.userMenu && els.userMenuDropdown && !els.userMenu.contains(e.target)) {
    els.userMenuDropdown.hidden = true;
  }
});

if (els.logoutBtn) {
  els.logoutBtn.addEventListener("click", async () => {
    await logout();
    if (els.userMenuDropdown) els.userMenuDropdown.hidden = true;
    showToast("Вы вышли из аккаунта");
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (els.bookingModal.classList.contains("is-open")) closeBookingModal();
  if (els.authModal.classList.contains("is-open")) closeAuthModal();
  const lb = document.getElementById("lightbox");
  if (lb) {
    lb.classList.remove("is-open");
    document.body.style.overflow = "";
  }
});

els.form?.addEventListener("submit", handleBookingSubmit);

bindChips(els.categoryChips, "category");
bindChips(els.districtChips, "district");

onSessionChange(renderHeader);
loadMasters();
