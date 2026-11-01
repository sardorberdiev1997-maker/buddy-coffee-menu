// Общее для экранов панели: Telegram WebApp (кнопки, подтверждения, вибрация), запросы к /api/admin, фото, форматы.
import { useEffect, useRef } from 'react';

export const WA = (window.Telegram && window.Telegram.WebApp) || null;
// Открыто как Mini App (есть подписанные данные Telegram)
export const inTelegram = !!(WA && WA.initData);
// Родные кнопки Telegram есть только в клиентах Telegram; в обычном браузере (проверка разработчиком) — свои
export const native = inTelegram && WA.platform !== 'unknown';

export function haptic(kind) {
  try {
    if (!native) return;
    if (kind === 'ok') WA.HapticFeedback.notificationOccurred('success');
    else if (kind === 'err') WA.HapticFeedback.notificationOccurred('error');
    else WA.HapticFeedback.selectionChanged();
  } catch (e) { /* старый клиент Telegram */ }
}

export const confirmBox = (text) => new Promise((resolve) => {
  if (native && WA.isVersionAtLeast('6.2')) WA.showConfirm(text, (ok) => resolve(!!ok));
  else resolve(window.confirm(text));
});

/* ---------- запросы ---------- */

export async function api(path, body) {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let res;
  try {
    res = await fetch('/api/admin/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: 'tma ' + (WA ? WA.initData : ''), ...(isForm || body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body)
    });
  } catch (e) {
    const err = new Error('network');
    err.code = 'network';
    throw err;
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(j.error || 'http_' + res.status);
    err.code = j.error || (res.status === 401 ? 'unauthorized' : 'other');
    err.status = res.status;
    throw err;
  }
  return j;
}

export function errorText(t, e) {
  const code = (e && e.code) || 'other';
  if (code.startsWith('setting:')) {
    const key = code.slice(8);
    return t.errField(t.fields[key] || key);
  }
  return t.errors[code] || t.errors.other;
}

/* ---------- кнопки Telegram ---------- */

// Главная кнопка внизу экрана (MainButton). В браузере без Telegram возвращает свою кнопку для отрисовки
export function useMainButton({ text, onClick, visible = true, active = true, progress = false }) {
  const handler = useRef(onClick);
  handler.current = onClick;
  useEffect(() => {
    if (!native) return undefined;
    const mb = WA.MainButton;
    const h = () => handler.current && handler.current();
    mb.onClick(h);
    return () => { mb.offClick(h); mb.hideProgress(); mb.hide(); };
  }, []);
  useEffect(() => {
    if (!native) return;
    const mb = WA.MainButton;
    if (!visible || !text) { mb.hide(); return; }
    // Неактивная — серая: некоторые клиенты (Telegram для macOS) сами её не приглушают
    const tp = WA.themeParams || {};
    mb.setParams(active
      ? { text, is_active: !progress, is_visible: true, color: tp.button_color || '#2481cc', text_color: tp.button_text_color || '#ffffff' }
      : { text, is_active: false, is_visible: true, color: tp.secondary_bg_color || '#e7e8ec', text_color: tp.hint_color || '#8e8e93' });
    if (progress) mb.showProgress(false);
    else mb.hideProgress();
  }, [text, visible, active, progress]);
  if (native || !visible || !text) return null;
  return { text, onClick: () => handler.current && handler.current(), disabled: !active || progress, loading: progress };
}

/* ---------- фото: квадрат 480 для карточки и 960×720 для шторки, WebP (Safari — JPEG) ---------- */

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('photo')); };
    img.src = url;
  });
}

function draw(src, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
  const k = Math.max(w / sw, h / sh); // как object-fit: cover — обрезаем края, блюдо по центру
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, (w - sw * k) / 2, (h - sh * k) / 2, sw * k, sh * k);
  return c;
}

const toBlob = (c) => new Promise((resolve) => {
  c.toBlob((b) => {
    if (b && b.type === 'image/webp') resolve(b);
    else c.toBlob(resolve, 'image/jpeg', 0.84);
  }, 'image/webp', 0.82);
});

export async function processPhoto(file) {
  let src;
  try {
    src = await createImageBitmap(file);
  } catch (e) {
    src = await loadImage(file);
  }
  const sq = draw(src, 480, 480);
  const l = draw(src, 960, 720);
  const out = { sq: await toBlob(sq), l: await toBlob(l), preview: sq.toDataURL('image/jpeg', 0.7) };
  if (!out.sq || !out.l) throw Object.assign(new Error('photo'), { code: 'bad_image' });
  return out;
}

export async function uploadPhoto(file) {
  const p = await processPhoto(file);
  const fd = new FormData();
  fd.append('sq', p.sq, 'sq');
  fd.append('l', p.l, 'l');
  const r = await api('photo', fd);
  return { img: r.img, preview: p.preview };
}

/* ---------- форматы ---------- */

export const fmt = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const num = (v) => {
  const n = parseInt(String(v == null ? '' : v).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

// Картинка блюда: фото из панели, файл из папки img, ссылка (в том числе Google Диск)
export function imgUrl(img, size = 'sq') {
  if (!img) return '';
  const up = img.match(/^up_([a-f0-9]{16})$/);
  if (up) return `/api/photo/${up[1]}/${size === 'l' ? 'l' : 'sq'}`;
  const drive = img.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/);
  if (drive) return `https://lh3.googleusercontent.com/d/${drive[1]}=w360`;
  if (/^https:\/\//i.test(img)) return img;
  if (/^[\w-]+$/.test(img)) return `/img/${size === 'l' ? 'l' : 's'}/${img}.webp`;
  return '';
}

const TZ = 'Asia/Tashkent';
export const when = (ms, lang) => new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'uz-Latn-UZ', {
  timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
}).format(new Date(ms));
// Дата в Ташкенте: YYYY-MM-DD
export const todayKey = (ms = Date.now()) => new Date(ms + 5 * 3600000).toISOString().slice(0, 10);

export const LANGS = ['uz', 'ru'];
export const otherLang = (l) => (l === 'uz' ? 'ru' : 'uz');
// Название на языке владельца, иначе на другом
export const nameOf = (x, lang) => (x && (x[lang] || x[otherLang(lang)])) || '';
