import {
  collection,
  query,
  where,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { db, CLOUDINARY } from "./firebase-config.js";
import {
  session,
  onSessionChange,
  logout,
  ensureMasterSubscription,
  getFreeUsed,
  FREE_MASTERS_LIMIT
} from "./auth.js";

const MAX_WORKS = 6;

/* 🔻 ВСТАВЬ СВОЮ ССЫЛКУ СБП ИЛИ НОМЕР ТЕЛЕФОНА 🔻 */
const SBP_LINK = "tel:+79381309240";

const els = {
  loading:          document.getElementById("cabinetLoading"),
  clientView:       document.getElementById("clientView"),
  masterView:       document.getElementById("masterView"),
  clientBookings:   document.getElementById("clientBookings"),
  masterBookings:   document.getElementById("masterBookings"),
  form:             document.getElementById("masterProfileForm"),
  deleteBtn:        document.getElementById("deleteProfileBtn"),
  masterAgree:      document.getElementById("masterAgreeCheckbox"),

  subBanner:        document.getElementById("subBanner"),
  subIcon:          document.getElementById("subIcon"),
  subTitle:         document.getElementById("subTitle"),
  subDesc:          document.getElementById("subDesc"),

  photoInput:       document.getElementById("photoInput"),
  photoPreview:     document.getElementById("photoPreview"),
  photoRemoveBtn:   document.getElementById("photoRemoveBtn"),
  photoProgress:    document.getElementById("photoProgress"),
  photoProgressBar: document.getElementById("photoProgressBar"),

  worksInput:       document.getElementById("worksInput"),
  worksGrid:        document.getElementById("worksGrid"),
  worksEmpty:       document.getElementById("worksEmpty"),
  worksProgress:    document.getElementById("worksProgress"),
  worksProgressBar: document.getElementById("worksProgressBar"),

  userMenu:         document.getElementById("userMenu"),
  userMenuTrigger:  document.getElementById("userMenuTrigger"),
  userMenuDropdown: document.getElementById("userMenuDropdown"),
  userAvatar:       document.getElementById("userAvatar"),
  logoutBtn:        document.getElementById("logoutBtn"),
  toast:            document.getElementById("toast"),
};

let currentPhotoUrl = "";
let currentWorks = [];
let profileExists = false;
let unsubBookings = null;

async function render() {
  if (!session.ready) {
    els.loading.textContent = "Проверяем вход…";
    return;
  }

  if (!session.user) {
    window.location.replace("index.html");
    return;
  }

  const avatar = session.user.photoURL;
  if (avatar) els.userAvatar.src = avatar;
  els.userMenu.hidden = false;

  els.loading.hidden = true;
  const role = session.profile?.role || "client";

  if (role === "master") {
    const updated = await ensureMasterSubscription(session.user.uid);
    if (updated) session.profile = { ...session.profile, ...updated };

    els.masterView.hidden = false;
    await renderSubscriptionBanner();
    await renderMasterView();
    subscribeMasterBookings();
  } else {
    els.clientView.hidden = false;
    subscribeClientBookings();
  }
}

async function renderSubscriptionBanner() {
  const status = session.profile?.subscriptionStatus;
  els.subBanner.hidden = false;

  if (status === "free") {
    const used = await getFreeUsed();
    const left = Math.max(0, FREE_MASTERS_LIMIT - used);
    els.subBanner.className = "sub-banner sub-banner--free";
    els.subIcon.textContent = "🎁";
    els.subTitle.textContent = "Бесплатный доступ активирован";
    els.subDesc.textContent = left > 0
      ? `Вы в числе первых мастеров. Занято ${used} из ${FREE_MASTERS_LIMIT}, осталось ${left}.`
      : `Вы в числе первых ${FREE_MASTERS_LIMIT} мастеров. Подписка 300 ₽/мес не нужна.`;
    return;
  }

  if (status === "pending") {
    const used = await getFreeUsed();
    els.subBanner.className = "sub-banner sub-banner--pending";
    els.subIcon.textContent = "💳";
    els.subTitle.textContent = "Нужна подписка 300 ₽/мес";
    els.subDesc.textContent =
      `Первые ${FREE_MASTERS_LIMIT} мест уже заняты (${used}/${FREE_MASTERS_LIMIT}). Оплатите подписку, чтобы активировать карточку.`;
    return;
  }

  els.subBanner.className = "sub-banner";
  els.subIcon.textContent = "ℹ️";
  els.subTitle.textContent = "Статус подписки неизвестен";
  els.subDesc.textContent = "Напишите в поддержку.";
}

/* ============ КЛИЕНТ — REAL TIME ============ */
function subscribeClientBookings() {
  if (unsubBookings) unsubBookings();

  const q = query(
    collection(db, "bookings"),
    where("clientUid", "==", session.user.uid)
  );

  unsubBookings = onSnapshot(q,
    (snap) => renderClientList(snap),
    (err) => {
      console.error("Ошибка потока заявок клиента:", err);
      els.clientBookings.innerHTML =
        `<p class="loading">Не удалось загрузить заявки 😔</p>`;
    }
  );
}

function renderClientList(snap) {
  if (snap.empty) {
    els.clientBookings.innerHTML =
      `<p class="loading">Пока нет заявок. Найдите мастера на главной 🌸</p>`;
    return;
  }

  const items = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  els.clientBookings.innerHTML = items.map(b => `
    <div class="booking-item">
      ${statusBadge(b.status)}
      <div class="booking-item__row">
        <span>Мастер</span>
        <b>${escapeHtml(b.masterName || "—")}</b>
      </div>
      <div class="booking-item__row">
        <span>Услуга</span>
        <b>${escapeHtml(b.serviceName || "—")}</b>
      </div>
      <div class="booking-item__row">
        <span>Когда</span>
        <b>${escapeHtml(b.date || "")} · ${escapeHtml(b.time || "")}</b>
      </div>
      <div class="booking-item__row">
        <span>Сервисный сбор</span>
        <b>${b.serviceFee || 0} ₽</b>
      </div>

      ${b.status === "confirmed" ? `
        <div class="booking-item__actions">
          <a href="${SBP_LINK}" class="btn btn--confirm">
            💳 Оплатить ${b.serviceFee} ₽
          </a>
        </div>
        <p class="booking-item__hint">
          После оплаты мастер отметит бронь как «Оплачено».
        </p>
      ` : ""}

      ${b.status === "paid" ? `
        <p class="booking-item__hint booking-item__hint--ok">
          ✓ Оплата получена. Хорошего визита!
        </p>
      ` : ""}
    </div>
  `).join("");
}

/* ============ МАСТЕР ============ */
async function renderMasterView() {
  await loadMasterProfile();
}

async function loadMasterProfile() {
  try {
    const snap = await getDoc(doc(db, "masters", session.user.uid));

    if (!snap.exists()) {
      profileExists = false;
      els.deleteBtn.hidden = true;
      return;
    }

    profileExists = true;
    els.deleteBtn.hidden = false;
    els.masterAgree.checked = true;

    const m = snap.data();
    document.getElementById("mName").value     = m.name || "";
    document.getElementById("mCategory").value = m.category || "Ногти";
    document.getElementById("mDistrict").value = m.district || "Кировский";
    document.getElementById("mService").value  = m.serviceName || "";
    document.getElementById("mPrice").value    = m.price || "";

    if (m.photoUrl) {
      currentPhotoUrl = m.photoUrl;
      setPreview(m.photoUrl);
    }

    currentWorks = Array.isArray(m.works) ? m.works : [];
    renderWorks();
  } catch (err) {
    console.error("Ошибка загрузки профиля мастера:", err);
  }
}

function setPreview(src) {
  els.photoPreview.innerHTML = `<img src="${src}" alt="Фото мастера" />`;
  els.photoRemoveBtn.hidden = false;
}
function clearPreview() {
  els.photoPreview.innerHTML = `<span class="photo-uploader__placeholder">💅</span>`;
  els.photoRemoveBtn.hidden = true;
}

function renderWorks() {
  els.worksEmpty.hidden = currentWorks.length > 0;
  els.worksGrid.innerHTML = currentWorks.map((url, i) => `
    <div class="work-item">
      <img src="${url}" alt="Работа ${i + 1}" />
      <button type="button" class="work-item__remove" data-work-index="${i}" aria-label="Удалить">×</button>
    </div>
  `).join("");
}

els.worksGrid.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-work-index]");
  if (!btn) return;
  const index = Number(btn.dataset.workIndex);
  if (!confirm("Удалить фото работы?")) return;

  currentWorks.splice(index, 1);
  renderWorks();

  await setDoc(doc(db, "masters", session.user.uid),
    { works: currentWorks }, { merge: true });
  showToast("Фото удалено");
});

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const MAX_WIDTH = 1200;
        const scale = Math.min(1, MAX_WIDTH / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);

        canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error("toBlob failed")),
          "image/jpeg",
          0.75
        );
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadToCloudinary(blob, publicId) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/image/upload`;
  const formData = new FormData();
  formData.append("file", blob);
  formData.append("upload_preset", CLOUDINARY.uploadPreset);
  formData.append("folder", CLOUDINARY.folder);
  formData.append("public_id", publicId);

  const res = await fetch(url, { method: "POST", body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Cloudinary upload failed: ${res.status}`);
  }
  const data = await res.json();
  return data.secure_url;
}

els.photoInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("Это не картинка 🌸");
    return;
  }
  try {
    els.photoProgress.hidden = false;
    els.photoProgressBar.style.width = "20%";

    const blob = await compressImage(file);
    setPreview(URL.createObjectURL(blob));

    els.photoProgressBar.style.width = "60%";
    const url = await uploadToCloudinary(blob, `avatar-${session.user.uid}`);

    els.photoProgressBar.style.width = "100%";
    els.photoProgress.hidden = true;

    currentPhotoUrl = url;
    setPreview(url);

    await setDoc(doc(db, "masters", session.user.uid),
      { photoUrl: url }, { merge: true });
    showToast("Аватарка загружена ✨");
  } catch (err) {
    console.error("Ошибка загрузки аватарки:", err);
    els.photoProgress.hidden = true;
    showToast("Не удалось загрузить фото");
  } finally {
    els.photoInput.value = "";
  }
});

els.photoRemoveBtn.addEventListener("click", async () => {
  if (!confirm("Удалить аватарку?")) return;
  await setDoc(doc(db, "masters", session.user.uid),
    { photoUrl: "" }, { merge: true });
  currentPhotoUrl = "";
  clearPreview();
  showToast("Аватарка удалена");
});

els.worksInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (files.length === 0) return;

  const slotsLeft = MAX_WORKS - currentWorks.length;
  if (slotsLeft <= 0) {
    showToast(`Максимум ${MAX_WORKS} работ`);
    els.worksInput.value = "";
    return;
  }

  const toUpload = files.slice(0, slotsLeft);
  if (files.length > slotsLeft) {
    showToast(`Загрузим первые ${slotsLeft} — лимит ${MAX_WORKS} фото`);
  }

  els.worksProgress.hidden = false;
  els.worksProgressBar.style.width = "0%";

  for (let i = 0; i < toUpload.length; i++) {
    const file = toUpload[i];
    if (!file.type.startsWith("image/")) continue;
    try {
      const pct = Math.round((i / toUpload.length) * 100);
      els.worksProgressBar.style.width = pct + "%";

      const blob = await compressImage(file);
      const publicId = `work-${session.user.uid}-${Date.now()}-${i}`;
      const url = await uploadToCloudinary(blob, publicId);

      currentWorks.push(url);
      renderWorks();

      await setDoc(doc(db, "masters", session.user.uid),
        { works: currentWorks }, { merge: true });
    } catch (err) {
      console.error("Ошибка загрузки работы:", err);
      showToast("Одно из фото не загрузилось");
    }
  }

  els.worksProgressBar.style.width = "100%";
  setTimeout(() => { els.worksProgress.hidden = true; }, 400);
  els.worksInput.value = "";
  showToast("Работы загружены ✨");
});

async function saveMasterProfile(e) {
  e.preventDefault();
  if (!session.user) return;

  /* Проверка согласия с офертой */
  if (!els.masterAgree.checked) {
    showToast("Подтвердите согласие с офертой и политикой");
    return;
  }

  const status = session.profile?.subscriptionStatus;
  if (status !== "free" && status !== "active") {
    showToast("Активируйте подписку, чтобы сохранить карточку");
    return;
  }

  const data = {
    name:        document.getElementById("mName").value.trim(),
    photoUrl:    currentPhotoUrl,
    works:       currentWorks,
    category:    document.getElementById("mCategory").value,
    district:    document.getElementById("mDistrict").value,
    serviceName: document.getElementById("mService").value.trim(),
    price:       Number(document.getElementById("mPrice").value),
    rating:      5.0,
    ownerUid:    session.user.uid,
    subscriptionStatus: status,
    agreeOferta: true,
    agreeAt:     serverTimestamp(),
    updatedAt:   serverTimestamp()
  };

  if (!data.name || !data.serviceName || !data.price) {
    showToast("Заполните обязательные поля 🌸");
    return;
  }

  const btn = els.form.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Сохраняем…";

  try {
    await setDoc(doc(db, "masters", session.user.uid), data, { merge: true });
    showToast("Карточка сохранена ✨");
    profileExists = true;
    els.deleteBtn.hidden = false;
  } catch (err) {
    console.error("Ошибка сохранения карточки:", err);
    showToast("Не удалось сохранить. Попробуйте позже.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Сохранить карточку";
  }
}

els.deleteBtn.addEventListener("click", async () => {
  if (!session.user) return;

  const confirmed = confirm(
    "Удалить карточку? Она исчезнет из каталога. Аккаунт останется, но карточку придётся заполнять заново."
  );
  if (!confirmed) return;

  els.deleteBtn.disabled = true;
  els.deleteBtn.textContent = "Удаляем…";

  try {
    await deleteDoc(doc(db, "masters", session.user.uid));
    showToast("Карточка удалена");

    document.getElementById("mName").value     = "";
    document.getElementById("mCategory").value = "Ногти";
    document.getElementById("mDistrict").value = "Кировский";
    document.getElementById("mService").value  = "";
    document.getElementById("mPrice").value    = "";

    currentPhotoUrl = "";
    currentWorks = [];
    clearPreview();
    renderWorks();

    profileExists = false;
    els.deleteBtn.hidden = true;
  } catch (err) {
    console.error("Ошибка удаления карточки:", err);
    showToast("Не удалось удалить карточку");
  } finally {
    els.deleteBtn.disabled = false;
    els.deleteBtn.textContent = "🗑 Удалить карточку";
  }
});

/* ============ ВХОДЯЩИЕ ЗАЯВКИ МАСТЕРА — REAL TIME ============ */
function subscribeMasterBookings() {
  if (unsubBookings) unsubBookings();

  const q = query(
    collection(db, "bookings"),
    where("masterId", "==", session.user.uid)
  );

  unsubBookings = onSnapshot(q,
    (snap) => renderMasterList(snap),
    (err) => {
      console.error("Ошибка потока заявок мастера:", err);
      els.masterBookings.innerHTML =
        `<p class="loading">Не удалось загрузить заявки 😔</p>`;
    }
  );
}

function renderMasterList(snap) {
  if (snap.empty) {
    els.masterBookings.innerHTML =
      `<p class="loading">Пока нет входящих заявок.</p>`;
    return;
  }

  const items = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  els.masterBookings.innerHTML = items.map(b => `
    <div class="booking-item">
      ${statusBadge(b.status)}
      <div class="booking-item__row">
        <span>Клиент</span>
        <b>${escapeHtml(b.clientName || "—")}</b>
      </div>
      <div class="booking-item__row">
        <span>Телефон</span>
        <b>${escapeHtml(b.clientPhone || "—")}</b>
      </div>
      <div class="booking-item__row">
        <span>Услуга</span>
        <b>${escapeHtml(b.serviceName || "—")}</b>
      </div>
      <div class="booking-item__row">
        <span>Когда</span>
        <b>${escapeHtml(b.date || "")} · ${escapeHtml(b.time || "")}</b>
      </div>
      <div class="booking-item__row">
        <span>К оплате мастеру</span>
        <b>${(b.price || 0) - (b.serviceFee || 0)} ₽</b>
      </div>

      ${b.status === "pending" ? `
        <div class="booking-item__actions">
          <button class="btn btn--confirm" data-booking-action="confirmed" data-booking-id="${b.id}">
            ✓ Подтвердить
          </button>
          <button class="btn btn--cancel" data-booking-action="cancelled" data-booking-id="${b.id}">
            Отменить
          </button>
        </div>
      ` : ""}

      ${b.status === "confirmed" ? `
        <div class="booking-item__actions">
          <button class="btn btn--confirm" data-booking-action="paid" data-booking-id="${b.id}">
            ✓ Отметить оплату
          </button>
          <button class="btn btn--cancel" data-booking-action="cancelled" data-booking-id="${b.id}">
            Отменить
          </button>
        </div>
      ` : ""}
    </div>
  `).join("");
}

els.masterBookings.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-booking-action]");
  if (!btn) return;

  const bookingId = btn.dataset.bookingId;
  const action = btn.dataset.bookingAction;

  const labels = {
    confirmed: "Подтвердить заявку?",
    cancelled: "Отменить заявку?",
    paid:      "Отметить как «Оплачено»?"
  };
  if (!confirm(labels[action])) return;

  btn.disabled = true;

  try {
    await updateDoc(doc(db, "bookings", bookingId), {
      status: action,
      statusUpdatedAt: serverTimestamp()
    });

    const msgs = {
      confirmed: "Заявка подтверждена ✓",
      cancelled: "Заявка отменена",
      paid:      "Оплата отмечена ✓"
    };
    showToast(msgs[action]);
  } catch (err) {
    console.error("Ошибка обновления заявки:", err);
    showToast("Не удалось обновить");
    btn.disabled = false;
  }
});

function statusBadge(status = "pending") {
  const map = {
    pending:   { text: "Ожидает",     cls: "pending" },
    confirmed: { text: "Ждёт оплаты", cls: "confirmed" },
    paid:      { text: "Оплачено",    cls: "paid" },
    cancelled: { text: "Отменена",    cls: "cancelled" }
  };
  const s = map[status] || map.pending;
  return `<span class="booking-item__status booking-item__status--${s.cls}">${s.text}</span>`;
}

let toastTimer = null;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove("is-visible");
  }, 2800);
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

els.form.addEventListener("submit", saveMasterProfile);

els.userMenuTrigger.addEventListener("click", () => {
  els.userMenuDropdown.hidden = !els.userMenuDropdown.hidden;
});

document.addEventListener("click", (e) => {
  if (!els.userMenu.contains(e.target)) els.userMenuDropdown.hidden = true;
});

els.logoutBtn.addEventListener("click", async () => {
  if (unsubBookings) unsubBookings();
  await logout();
  window.location.replace("index.html");
});

onSessionChange(render);
