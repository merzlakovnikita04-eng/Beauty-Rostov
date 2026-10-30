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
  addDoc,
  increment,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { db } from "./firebase-config.js";
import {
  session,
  onSessionChange,
  logout,
  ensureMasterSubscription,
  getFreeUsed,
  FREE_MASTERS_LIMIT
} from "./auth.js";

const MAX_WORKS = 6;
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_TEXTAREA = 500;

const CLOUDINARY = {
  cloudName: "whrxpqma",
  uploadPreset: "beauty_unsigned",
  folder: "masters"
};

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
let rendering = false;
let profileLoaded = false;
let worksProgressTimer = null;
let reviewModalOpen = false;

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

/* ============ RENDER ============ */
async function render() {
  if (rendering) return;
  rendering = true;
  try {
    if (!session.ready) {
      els.loading.textContent = "Проверяем вход…";
      return;
    }

    if (!session.user) {
      window.location.replace("index.html");
      return;
    }

    els.userAvatar.src = session.user.photoURL || DEFAULT_PHOTO;
    els.userMenu.hidden = false;

    const role = session.profile?.role || "client";

    if (role === "master") {
      els.loading.textContent = "Загружаем кабинет мастера…";
      const updated = await ensureMasterSubscription(session.user.uid);
      if (updated) session.profile = { ...session.profile, ...updated };

      await renderSubscriptionBanner();
      await loadMasterProfile();
      els.loading.hidden = true;
      els.masterView.hidden = false;
      subscribeMasterBookings();
    } else {
      els.loading.hidden = true;
      els.clientView.hidden = false;
      subscribeClientBookings();
    }
  } finally {
    rendering = false;
  }
}

async function renderSubscriptionBanner() {
  const status = session.profile?.subscriptionStatus;
  els.subBanner.hidden = false;

  const used = await getFreeUsed();

  if (status === "free") {
    const left = Math.max(0, FREE_MASTERS_LIMIT - used);
    els.subBanner.className = "sub-banner sub-banner--free";
    els.subIcon.textContent = "🎁";
    els.subTitle.textContent = "Бесплатный доступ активирован";
    els.subDesc.textContent = left > 0
      ? `Вы в числе первых мастеров. Занято ${used} из ${FREE_MASTERS_LIMIT}, осталось ${left}.`
      : `Вы в числе первых ${FREE_MASTERS_LIMIT} мастеров. Абонентская плата не нужна.`;
    return;
  }

  if (status === "pending") {
    els.subBanner.className = "sub-banner sub-banner--pending";
    els.subIcon.textContent = "⏳";
    els.subTitle.textContent = "Заявка на доступ в очереди";
    els.subDesc.textContent =
      `Первые ${FREE_MASTERS_LIMIT} мест заняты (${used}/${FREE_MASTERS_LIMIT}). Мы свяжемся с вами.`;
    return;
  }

  els.subBanner.className = "sub-banner";
  els.subIcon.textContent = "ℹ️";
  els.subTitle.textContent = "Статус доступа неизвестен";
  els.subDesc.textContent = "Напишите в поддержку.";
}

/* ============ КЛИЕНТ ============ */
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
        <span>Стоимость</span>
        <b>${Number(b.price || 0)} ₽</b>
      </div>

      ${b.status === "paid" ? `
        <p class="booking-item__hint booking-item__hint--ok">
          ✓ Визит завершён. Спасибо!
        </p>
      ` : ""}

      ${b.status === "paid" && !b.hasReview ? `
        <div class="booking-item__actions">
          <button class="btn btn--primary" data-review-master="${escapeHtml(b.masterId)}" data-review-booking="${escapeHtml(b.id)}">
            ⭐ Оставить отзыв
          </button>
        </div>
      ` : ""}
    </div>
  `).join("");
}

/* ============ ОТЗЫВЫ ============ */
els.clientBookings.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-review-master]");
  if (!btn) return;
  if (reviewModalOpen) return;
  openReviewModal(btn.dataset.reviewMaster, btn.dataset.reviewBooking);
});

function openReviewModal(masterId, bookingId) {
  reviewModalOpen = true;
  const modal = document.createElement("div");
  modal.className = "modal is-open";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `
    <div class="modal__overlay" data-close-review></div>
    <div class="modal__content">
      <button class="modal__close" data-close-review aria-label="Закрыть">×</button>
      <h2 class="modal__title">Оставить отзыв</h2>
      <p class="modal__subtitle">Поделитесь впечатлениями о визите</p>
      <form id="reviewForm" class="form">
        <div class="rating-input">
          ${[5,4,3,2,1].map(i => `
            <label>
              <input type="radio" name="rating" value="${i}" required />
              <span>★</span>
            </label>
          `).join("")}
        </div>
        <label class="form__label">
          Ваш отзыв
          <textarea id="reviewText" class="form__input" rows="4" required maxlength="${MAX_TEXTAREA}" placeholder="Как всё прошло?"></textarea>
        </label>
        <button type="submit" class="btn btn--primary btn--block">Отправить</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  document.body.style.overflow = "hidden";

  const close = () => {
    modal.remove();
    document.body.style.overflow = "";
    reviewModalOpen = false;
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);

  modal.addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-close-review")) close();
  });

  modal.querySelector("#reviewForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const checked = modal.querySelector('input[name="rating"]:checked');
    if (!checked) { showToast("Поставьте оценку"); return; }

    const rating = Number(checked.value);
    const text = modal.querySelector("#reviewText").value.trim();
    if (!text) { showToast("Напишите отзыв"); return; }

    const btn = modal.querySelector('button[type="submit"]');
    btn.disabled = true;

    try {
      await runTransaction(db, async (tx) => {
        const bookingRef = doc(db, "bookings", bookingId);
        const bookingSnap = await tx.get(bookingRef);
        const b = bookingSnap.data();
        if (!b) throw new Error("Нет брони");
        if (b.clientUid !== session.user.uid) throw new Error("Чужая бронь");
        if (b.masterId !== masterId) throw new Error("Не тот мастер");
        if (b.status !== "paid") throw new Error("Сначала завершите визит");
        if (b.hasReview) throw new Error("Отзыв уже есть");

        const masterRef = doc(db, "masters", masterId);
        const masterSnap = await tx.get(masterRef);
        if (!masterSnap.exists()) throw new Error("Мастер не найден");

        const reviewRef = doc(collection(db, "reviews"));
        tx.set(reviewRef, {
          masterId,
          bookingId,
          clientUid: session.user.uid,
          clientName: session.profile?.name || "Клиент",
          rating,
          text,
          createdAt: serverTimestamp()
        });
        tx.update(bookingRef, { hasReview: true });
        tx.update(masterRef, {
          ratingSum: increment(rating),
          ratingCount: increment(1)
        });
      });

      showToast("Спасибо за отзыв! ✨");
      close();
    } catch (err) {
      console.error("Ошибка отзыва:", err);
      showToast(err.message || "Не удалось отправить отзыв");
      btn.disabled = false;
    }
  });
}

/* ============ МАСТЕР ============ */
async function loadMasterProfile() {
  try {
    const snap = await getDoc(doc(db, "masters", session.user.uid));

    if (!snap.exists()) {
      profileExists = false;
      profileLoaded = true;
      els.deleteBtn.hidden = true;
      return;
    }

    profileExists = true;
    profileLoaded = true;
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

    currentWorks = Array.isArray(m.works) ? m.works.filter(Boolean) : [];
    renderWorks();
  } catch (err) {
    console.error("Ошибка загрузки профиля мастера:", err);
    profileLoaded = false;
    showToast("Не удалось загрузить карточку. Обновите страницу.");
  }
}

function setPreview(src) {
  els.photoPreview.innerHTML = `<img src="${escapeHtml(src)}" alt="Фото мастера" />`;
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
      <img src="${escapeHtml(url)}" alt="Работа ${i + 1}" />
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
    { works: currentWorks, updatedAt: serverTimestamp() }, { merge: true });
  showToast("Фото удалено");
});

function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_INPUT_BYTES) {
      reject(new Error("Файл больше 15 МБ"));
      return;
    }
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
    els.photoProgressBar.style.width = "60%";
    const url = await uploadToCloudinary(blob, `avatar-${session.user.uid}`);

    els.photoProgressBar.style.width = "100%";
    els.photoProgress.hidden = true;

    currentPhotoUrl = url;
    setPreview(url);

    await setDoc(doc(db, "masters", session.user.uid),
      { photoUrl: url, updatedAt: serverTimestamp() }, { merge: true });
    showToast("Аватарка загружена ✨");
  } catch (err) {
    console.error("Ошибка загрузки аватарки:", err);
    els.photoProgress.hidden = true;
    showToast(err.message || "Не удалось загрузить фото");
  } finally {
    els.photoInput.value = "";
  }
});

els.photoRemoveBtn.addEventListener("click", async () => {
  if (!confirm("Удалить аватарку?")) return;
  await setDoc(doc(db, "masters", session.user.uid),
    { photoUrl: "", updatedAt: serverTimestamp() }, { merge: true });
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
      const publicId = `work-${session.user.uid}-${crypto.randomUUID()}`;
      const url = await uploadToCloudinary(blob, publicId);

      currentWorks.push(url);
      renderWorks();

      await setDoc(doc(db, "masters", session.user.uid),
        { works: currentWorks, updatedAt: serverTimestamp() }, { merge: true });
    } catch (err) {
      console.error("Ошибка загрузки работы:", err);
      showToast("Одно из фото не загрузилось");
    }
  }

  els.worksProgressBar.style.width = "100%";
  clearTimeout(worksProgressTimer);
  worksProgressTimer = setTimeout(() => { els.worksProgress.hidden = true; }, 400);
  els.worksInput.value = "";
  showToast("Работы загружены ✨");
});

async function saveMasterProfile(e) {
  e.preventDefault();
  if (!session.user) return;

  if (!els.masterAgree.checked) {
    showToast("Подтвердите согласие с офертой и политикой");
    return;
  }

  const status = session.profile?.subscriptionStatus;
  if (status !== "free" && status !== "active") {
    showToast("Активируйте доступ, чтобы сохранить карточку");
    return;
  }

  if (!profileLoaded) {
    showToast("Дождитесь загрузки карточки");
    return;
  }

  const price = Number(document.getElementById("mPrice").value);
  if (!Number.isFinite(price) || price < 100 || price > 1_000_000) {
    showToast("Цена должна быть от 100 до 1 000 000 ₽");
    return;
  }

  const data = {
    name:        document.getElementById("mName").value.trim(),
    photoUrl:    currentPhotoUrl,
    works:       currentWorks,
    category:    document.getElementById("mCategory").value,
    district:    document.getElementById("mDistrict").value,
    serviceName: document.getElementById("mService").value.trim(),
    price,
    ownerUid:    session.user.uid,
    agreeOferta: true,
    agreeAt:     serverTimestamp(),
    updatedAt:   serverTimestamp()
  };

  if (!data.name || !data.serviceName) {
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

/* ============ ВХОДЯЩИЕ ЗАЯВКИ МАСТЕРА ============ */
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
        <span>Стоимость</span>
        <b>${Number(b.price || 0)} ₽</b>
      </div>

      ${b.status === "pending" ? `
        <div class="booking-item__actions">
          <button class="btn btn--confirm" data-booking-action="confirmed" data-booking-id="${escapeHtml(b.id)}">
            ✓ Подтвердить
          </button>
          <button class="btn btn--cancel" data-booking-action="cancelled" data-booking-id="${escapeHtml(b.id)}">
            Отменить
          </button>
        </div>
      ` : ""}

      ${b.status === "confirmed" ? `
        <div class="booking-item__actions">
          <button class="btn btn--confirm" data-booking-action="paid" data-booking-id="${escapeHtml(b.id)}">
            ✓ Клиент оплатил
          </button>
          <button class="btn btn--cancel" data-booking-action="cancelled" data-booking-id="${escapeHtml(b.id)}">
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
    paid:      "Отметить, что клиент оплатил?"
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
    pending:   { text: "Ожидает",       cls: "pending" },
    confirmed: { text: "Подтверждена",  cls: "confirmed" },
    paid:      { text: "Оплачено",      cls: "paid" },
    cancelled: { text: "Отменена",      cls: "cancelled" }
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
