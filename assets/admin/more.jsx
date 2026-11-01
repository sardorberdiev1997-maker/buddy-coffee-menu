// Экраны: информация о кафе, расписание, акции и цены, рассылка, статистика, сотрудники, история
import { Button, ButtonCell, Cell, Checkbox, Info, Input, List, Placeholder, Radio, Section, SegmentedControl, Select, Spinner, Switch, Textarea } from '@telegram-apps/telegram-ui';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { api, confirmBox, errorText, fmt, haptic, nameOf, native, num, otherLang, todayKey, uploadPhoto, useMainButton, WA, when } from './lib.js';
import { Bottom, Field, Ico, Thumb } from './ui.jsx';

/* ---------- информация о кафе: ключи «Настроек» ---------- */

const GROUPS = [
  ['head', ['слоган', 'подзаголовок', 'объявление']],
  ['contacts', ['телефон', 'адрес', 'ссылка_на_карту', 'координаты']],
  ['work', ['часы_работы', 'оплата', 'доставка']],
  ['wifi', ['wifi_сеть', 'wifi_пароль']],
  ['social', ['instagram', 'telegram', 'отзыв_google', 'отзыв_yandex']],
  ['orders', ['мин_заказ', 'время_доставки', 'время_самовывоза']],
  ['legal', ['продавец']],
  ['other', ['примечание_к_фото', 'описание_бота']]
];
const MONO = new Set(['телефон', 'ссылка_на_карту', 'координаты', 'wifi_сеть', 'wifi_пароль', 'instagram', 'telegram', 'отзыв_google', 'отзыв_yandex', 'мин_заказ', 'время_доставки', 'время_самовывоза']);
const LONG = new Set(['объявление', 'адрес', 'продавец', 'примечание_к_фото', 'описание_бота']);
const MAX = { 'объявление': 200, 'описание_бота': 120, 'адрес': 200, 'продавец': 200, 'примечание_к_фото': 200 };
const NUMERIC = new Set(['мин_заказ']);
// Карта (Leaflet) — отдельным файлом, только когда её открыли
const MapPicker = lazy(() => import('./map.jsx'));

function getLocation() {
  return new Promise((resolve, reject) => {
    const viaBrowser = () => {
      if (!navigator.geolocation) { reject(new Error('geo')); return; }
      navigator.geolocation.getCurrentPosition((p) => resolve(p.coords), reject, { enableHighAccuracy: true, timeout: 15000 });
    };
    // Bot API 8.0: LocationManager — родной запрос геопозиции Telegram
    if (native && WA.isVersionAtLeast('8.0') && WA.LocationManager) {
      WA.LocationManager.init(() => {
        if (!WA.LocationManager.isLocationAvailable) { viaBrowser(); return; }
        WA.LocationManager.getLocation((d) => (d ? resolve(d) : viaBrowser()));
      });
    } else viaBrowser();
  });
}

export function InfoScreen({ ctx }) {
  const { st, t, lang } = ctx;
  const other = otherLang(lang);
  const start = useMemo(() => {
    const s = {};
    GROUPS.forEach(([, keys]) => keys.forEach((k) => {
      const v = (st.doc.settings || {})[k] || { uz: '', ru: '' };
      s[k] = MONO.has(k) ? { uz: v.uz || v.ru || '', ru: v.uz || v.ru || '' } : { uz: v.uz || '', ru: v.ru || '' };
    }));
    return s;
  }, []);
  const [f, setF] = useState(start);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState({});
  const [map, setMap] = useState(false);
  const changed = Object.keys(f).filter((k) => f[k].uz !== start[k].uz || f[k].ru !== start[k].ru);
  useEffect(() => { ctx.setDirty(changed.length > 0); }, [changed.length]);
  const set = (k, l, v) => {
    setF((p) => ({ ...p, [k]: MONO.has(k) ? { uz: v, ru: v } : { ...p[k], [l]: v } }));
    setErr((e) => ({ ...e, [k]: '' }));
  };
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('settings', { values: Object.fromEntries(changed.map((k) => [k, MONO.has(k) ? f[k].uz : f[k]])) });
      haptic('ok');
      ctx.setDirty(false);
      ctx.setSt(r);
      ctx.toast(t.saved, { undo: r.change });
      ctx.pop(true);
    } catch (e) {
      if (e.code && e.code.startsWith('setting:')) setErr({ [e.code.slice(8)]: errorText(t, e) });
      ctx.fail(e);
    } finally {
      setBusy(false);
    }
  };
  const btn = useMainButton({ text: t.save, onClick: save, active: changed.length > 0, progress: busy });
  const locate = async () => {
    try {
      const c = await getLocation();
      set('координаты', 'uz', `${c.latitude.toFixed(6)}, ${c.longitude.toFixed(6)}`);
      haptic('ok');
    } catch (e) {
      ctx.toast(t.locFail);
    }
  };
  const coords = (f['координаты'].uz.match(/^(-?[\d.]+)\s*,\s*(-?[\d.]+)$/) || []).slice(1);
  const input = (k, l) => {
    const props = {
      value: f[k][l], maxLength: MAX[k] || 120, status: err[k] ? 'error' : undefined,
      onChange: (e) => set(k, l, NUMERIC.has(k) ? e.target.value.replace(/[^\d]/g, '') : e.target.value)
    };
    if (NUMERIC.has(k)) props.inputMode = 'numeric';
    if (k === 'телефон') props.inputMode = 'tel';
    if (/^(ссылка|instagram|telegram|отзыв)/.test(k)) { props.inputMode = 'url'; props.placeholder = 'https://'; }
    return LONG.has(k) ? <Textarea {...props} /> : <Input {...props} />;
  };
  return (
    <List>
      {GROUPS.map(([g, keys]) => (
        <Section key={g} header={t.groups[g]}>
          {keys.map((k) => (MONO.has(k) ? (
            <Field key={k} label={t.fields[k]} error={err[k]}>{input(k, 'uz')}</Field>
          ) : (
            <div key={k}>
              <Field label={`${t.fields[k]} · ${t.uzRu(lang)}`} error={err[k]}>{input(k, lang)}</Field>
              <Field label={`${t.fields[k]} · ${t.uzRu(other)}`}>{input(k, other)}</Field>
            </div>
          )))}
          {g === 'contacts' ? (
            <>
              <ButtonCell before={<Ico e="🗺" />} onClick={() => setMap(!map)}>{map ? t.mapHide : t.pickOnMap}</ButtonCell>
              {map ? (
                <Suspense fallback={<div className="map map--loading"><Spinner size="m" /></div>}>
                  <MapPicker value={f['координаты'].uz} onChange={(v) => set('координаты', 'uz', v)} />
                  <div className="hint">{t.mapHint}</div>
                </Suspense>
              ) : null}
              <ButtonCell before={<Ico e="📍" />} onClick={locate}>{t.myLocation}</ButtonCell>
              {coords.length ? (
                <ButtonCell before={<Ico e="🔎" />} onClick={() => WA.openLink(`https://yandex.uz/maps/?pt=${coords[1]},${coords[0]}&z=17&l=map`)}>{t.openMap}</ButtonCell>
              ) : null}
            </>
          ) : null}
        </Section>
      ))}
      <div className="spacer" />
      <Bottom btn={btn} />
    </List>
  );
}

/* ---------- расписание: объявление до даты, особые дни, «Сегодня закрыты» ---------- */

export function ScheduleScreen({ ctx }) {
  const { st, t, lang } = ctx;
  const today = todayKey();
  const sch = st.doc.schedule || { noticeUntil: '', special: [] };
  const start = useMemo(() => ({
    noticeUntil: sch.noticeUntil || '',
    special: (sch.special || []).map((s) => ({ date: s.date, hours: s[lang] || s.uz || s.ru || '', closed: !!s.closed }))
  }), []);
  const [f, setF] = useState(start);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  useEffect(() => { ctx.setDirty(dirty); }, [dirty]);
  const setDay = (i, k, v) => setF((p) => ({ ...p, special: p.special.map((s, j) => (j === i ? { ...s, [k]: v } : s)) }));
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('schedule', {
        noticeUntil: f.noticeUntil,
        special: f.special.filter((s) => s.date).map((s) => ({ date: s.date, uz: s.hours, ru: s.hours, closed: s.closed }))
      });
      haptic('ok');
      ctx.setDirty(false);
      ctx.setSt(r);
      ctx.toast(t.saved, { undo: r.change });
      ctx.pop(true);
    } catch (e) {
      ctx.fail(e);
    } finally {
      setBusy(false);
    }
  };
  const btn = useMainButton({ text: t.save, onClick: save, active: dirty, progress: busy });
  const notice = (st.doc.settings || {})['объявление'] || {};
  const act = (path, body) => ctx.run(() => api(path, body)).then((r) => r && ctx.setSt(r));
  return (
    <List>
      <Section>
        <Cell Component="label" multiline description={t.closedSub} after={<Switch aria-label={t.closedToday} checked={st.live.closed} onChange={(e) => act('closed', { on: e.target.checked })} />}>{t.closedToday}</Cell>
      </Section>
      <Section header={t.noticeUntil} footer={t.noticeUntilSub}>
        <Cell multiline subtitle={notice[lang] || notice[otherLang(lang)] || '—'}>{t.currentNotice}</Cell>
        <Field><Input type="date" aria-label={t.noticeUntil} min={today} value={f.noticeUntil} onChange={(e) => setF((p) => ({ ...p, noticeUntil: e.target.value }))} /></Field>
      </Section>
      <Section header={t.special} footer={t.specialSub}>
        {f.special.map((s, i) => (
          <div key={i} className="day">
            <Field label={t.date}><Input type="date" min={today} value={s.date} onChange={(e) => setDay(i, 'date', e.target.value)} /></Field>
            {!s.closed ? <Field label={t.hours}><Input value={s.hours} maxLength={60} placeholder="10:00–18:00" onChange={(e) => setDay(i, 'hours', e.target.value)} /></Field> : null}
            <Cell Component="label" after={<Switch aria-label={`${t.closedDay} ${s.date || ''}`.trim()} checked={s.closed} onChange={(e) => setDay(i, 'closed', e.target.checked)} />}>{t.closedDay}</Cell>
            <ButtonCell mode="destructive" onClick={() => setF((p) => ({ ...p, special: p.special.filter((_, j) => j !== i) }))}>{t.delete}</ButtonCell>
          </div>
        ))}
        <ButtonCell before={<Ico e="➕" />} onClick={() => setF((p) => ({ ...p, special: [...p.special, { date: today, hours: '', closed: false }] }))}>{t.addDay}</ButtonCell>
      </Section>
      <div className="spacer" />
      <Bottom btn={btn} />
    </List>
  );
}

/* ---------- акции: блюдо дня; массовое изменение цен ---------- */

export function PromoScreen({ ctx }) {
  const { st, t, lang } = ctx;
  const today = todayKey();
  const day = st.doc.promo && st.doc.promo.day && st.doc.promo.day.date === today ? st.doc.items.find((x) => x.key === st.doc.promo.day.key) : null;
  const [pick, setPick] = useState('');
  const [cats, setCats] = useState([]);
  const [mode, setMode] = useState('percent');
  const [value, setValue] = useState('');
  const [round, setRound] = useState(500);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const act = (path, body) => ctx.run(() => api(path, body)).then((r) => r && ctx.setSt(r));
  const params = () => ({ cats, mode, value: Number(String(value).replace(',', '.').replace(/[^\d.-]/g, '')), round });
  const preview = async () => {
    const r = await ctx.run(() => api('bulk', params()));
    if (r) setPlan(r.items);
  };
  const apply = async () => {
    if (!(await confirmBox(t.bulkConfirm(plan.length)))) return;
    setBusy(true);
    const r = await ctx.run(() => api('bulk', { ...params(), apply: true }));
    setBusy(false);
    if (r) { ctx.setSt(r); setPlan(null); setValue(''); ctx.toast(t.saved, { undo: r.change }); }
  };
  const btn = useMainButton({ text: plan && plan.length ? t.bulkApply(plan.length) : '', onClick: apply, visible: !!(plan && plan.length), progress: busy });
  const cur = lang === 'ru' ? 'сум' : 'so‘m';
  return (
    <List>
      <Section header={t.dayDishSec} footer={t.dayHint}>
        {day ? (
          <>
            <Cell before={<Thumb img={day.img} />} subtitle={t.isDay}>{nameOf(day, lang)}</Cell>
            <ButtonCell mode="destructive" onClick={() => act('promo', { day: null })}>{t.removeDay}</ButtonCell>
          </>
        ) : <Cell multiline subtitle={t.dayNone}>{t.dayDish}</Cell>}
        <Field label={t.pickDish}>
          <Select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">—</option>
            {st.doc.cats.map((c) => (
              <optgroup key={c.id} label={nameOf(c, lang)}>
                {st.doc.items.filter((x) => x.cat === c.id && x.avail).map((x) => <option key={x.key} value={x.key}>{nameOf(x, lang)}</option>)}
              </optgroup>
            ))}
          </Select>
        </Field>
        <ButtonCell before={<Ico e="⭐️" />} disabled={!pick} onClick={() => act('promo', { day: pick }).then(() => setPick(''))}>{t.makeDay}</ButtonCell>
      </Section>
      <Section><Cell multiline subtitle={t.saleHint}>🏷</Cell></Section>
      <Section header={t.bulk}>
        <Field label={t.bulkCats}>
          {st.doc.cats.map((c) => (
            <Cell key={c.id} Component="label" before={<Checkbox aria-label={nameOf(c, lang)} checked={cats.includes(c.id)} onChange={(e) => { setPlan(null); setCats((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id))); }} />}>
              {`${c.icon || ''} ${nameOf(c, lang)}`.trim()}
            </Cell>
          ))}
        </Field>
        <Field label={t.bulkMode}>
          <SegmentedControl className="segs">
            <SegmentedControl.Item selected={mode === 'percent'} onClick={() => { setMode('percent'); setPlan(null); }}>{t.percent}</SegmentedControl.Item>
            <SegmentedControl.Item selected={mode === 'amount'} onClick={() => { setMode('amount'); setPlan(null); }}>{t.amount}</SegmentedControl.Item>
          </SegmentedControl>
        </Field>
        <Field label={t.bulkValue}>
          <Input inputMode="decimal" value={value} placeholder={mode === 'percent' ? '+10' : '+2000'} onChange={(e) => { setValue(e.target.value); setPlan(null); }} />
        </Field>
        <Field label={t.round}>
          <SegmentedControl className="segs">
            {[100, 500, 1000].map((r) => <SegmentedControl.Item key={r} selected={round === r} onClick={() => { setRound(r); setPlan(null); }}>{fmt(r)}</SegmentedControl.Item>)}
          </SegmentedControl>
        </Field>
        <ButtonCell before={<Ico e="👀" />} disabled={!cats.length || !Number(String(value).replace(/[^\d.-]/g, ''))} onClick={preview}>{t.bulkPreview}</ButtonCell>
      </Section>
      {plan ? (
        <Section header={plan.length ? t.bulkApply(plan.length) : t.bulkNothing}>
          {plan.map((x) => (
            <Cell key={x.key} multiline subtitle={x.before.map((p, i) => `${fmt(p)} → ${fmt(x.after[i])}`).join(' · ') + ' ' + cur}>{x[lang] || x[otherLang(lang)]}</Cell>
          ))}
        </Section>
      ) : null}
      <div className="spacer" />
      <Bottom btn={btn} />
    </List>
  );
}

/* ---------- рассылка ---------- */

export function BroadcastScreen({ ctx }) {
  const { t } = ctx;
  const [text, setText] = useState('');
  const [img, setImg] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [aud, setAud] = useState('all');
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const file = useRef(null);
  const load = () => api('broadcast').then(setInfo).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!info || !info.list.some((b) => b.status === 'sending')) return undefined;
    const id = setTimeout(load, 5000);
    return () => clearTimeout(id);
  }, [info]);
  useEffect(() => { ctx.setDirty(!!(text.trim() || img)); }, [text, img]);
  const test = async () => {
    setBusy(true);
    const r = await ctx.run(() => api('broadcast/test', { text, img: img && img.img }));
    setBusy(false);
    if (r) { setDraft(r); setInfo({ list: r.list, counts: r.counts }); }
  };
  const counts = (draft && draft.counts) || (info && info.counts) || { all: 0, active: 0, sleep: 0 };
  const send = async () => {
    if (!(await confirmBox(t.bcConfirm(counts[aud])))) return;
    setBusy(true);
    const r = await ctx.run(() => api('broadcast/send', { id: draft.id, audience: aud }));
    setBusy(false);
    if (r) { setInfo(r); setDraft(null); setText(''); setImg(null); ctx.setDirty(false); }
  };
  const btn = useMainButton({ text: draft ? t.bcSend(counts[aud]) : '', onClick: send, visible: !!draft, active: counts[aud] > 0, progress: busy });
  const pick = async (e) => {
    const fl = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!fl) return;
    setPhotoBusy(true);
    try { setImg(await uploadPhoto(fl)); setDraft(null); } catch (err) { ctx.fail(err.code ? err : { code: 'bad_image' }); }
    setPhotoBusy(false);
  };
  return (
    <List>
      <Section header={t.broadcast} footer={t.bcHint}>
        <Field label={t.bcText}><Textarea value={text} maxLength={img ? 1000 : 4000} rows={6} onChange={(e) => { setText(e.target.value); setDraft(null); }} /></Field>
        {img ? <div className="photo photo--small"><img src={img.preview} alt="" /></div> : null}
        <input ref={file} type="file" accept="image/*" hidden onChange={pick} />
        <ButtonCell before={<Ico e="🖼" />} onClick={() => file.current.click()} disabled={photoBusy}>{photoBusy ? t.photoBusy : t.bcPhoto}</ButtonCell>
        {img ? <ButtonCell mode="destructive" onClick={() => { setImg(null); setDraft(null); }}>{t.photoRemove}</ButtonCell> : null}
        <ButtonCell before={<Ico e="🧪" />} disabled={busy || (!text.trim() && !img)} onClick={test}>{t.bcTest}</ButtonCell>
      </Section>
      {draft ? (
        <Section header={t.bcAud} footer={t.bcTestSent}>
          {[['all', t.bcAll], ['active', t.bcActive], ['sleep', t.bcSleep]].map(([k, label]) => (
            <Cell key={k} Component="label" before={<Radio name="aud" checked={aud === k} onChange={() => setAud(k)} />} after={<Info type="text">{counts[k]}</Info>}>{label}</Cell>
          ))}
        </Section>
      ) : null}
      {info && info.list.length ? (
        <Section header={t.bcRecent}>
          {info.list.map((b) => (
            <Cell key={b.id} multiline subtitle={`${b.created_by || ''} · ${when(b.created_at, ctx.lang)}`}
              after={b.status === 'sending' ? <Button size="s" mode="bezeled" onClick={() => ctx.run(() => api('broadcast/stop', { id: b.id })).then((r) => r && setInfo(r))}>{t.bcStop}</Button> : <Info type="text">{b.status === 'draft' ? '' : `${b.sent}/${b.total}`}</Info>}>
              {`№${b.id} · ${t.bcStatus[b.status] || b.status}`}
            </Cell>
          ))}
        </Section>
      ) : null}
      <div className="spacer" />
      <Bottom btn={btn} />
    </List>
  );
}

/* ---------- статистика ---------- */

export function StatsScreen({ ctx }) {
  const { t, lang } = ctx;
  const [period, setPeriod] = useState('today');
  const [s, setS] = useState(null);
  useEffect(() => {
    setS(null);
    api('stats?period=' + period).then(setS).catch((e) => ctx.fail(e));
  }, [period]);
  const cur = lang === 'ru' ? 'сум' : 'so‘m';
  const pct = s && s.prev.revenue ? Math.round((s.revenue - s.prev.revenue) / s.prev.revenue * 100) : null;
  const done = s ? s.done : 0;
  return (
    <List>
      <div className="pad">
        <SegmentedControl className="segs">
          {Object.entries(t.periods).map(([k, label]) => <SegmentedControl.Item key={k} selected={period === k} onClick={() => setPeriod(k)}>{label}</SegmentedControl.Item>)}
        </SegmentedControl>
      </div>
      {!s ? <div className="center"><Spinner size="m" /></div> : (
        <>
          <Section>
            <Cell multiline subtitle={pct == null ? undefined : `${pct > 0 ? '+' : ''}${pct}% ${t.vsPrev}`} after={<Info type="text">{`${fmt(s.revenue)} ${cur}`}</Info>}>{t.revenue}</Cell>
            <Cell after={<Info type="text">{fmt(done)}</Info>}>{t.orders}</Cell>
            <Cell after={<Info type="text">{done ? `${fmt(s.revenue / done)} ${cur}` : '—'}</Info>}>{t.avg}</Cell>
            <Cell after={<Info type="text">{`${fmt(s.delivery)} / ${fmt(s.pickup)}`}</Info>}>{`${t.delivery} / ${t.pickup}`}</Cell>
            <Cell after={<Info type="text">{fmt(s.fresh)}</Info>}>{t.fresh}</Cell>
            <Cell after={<Info type="text">{s.canceled ? `${fmt(s.canceled)} · ${fmt(s.lost)} ${cur}` : '0'}</Info>}>{t.canceled}</Cell>
            {s.rating ? <Cell after={<Info type="text">{`★ ${s.rating.avg.toFixed(1)} · ${s.rating.n}`}</Info>}>{t.rating}</Cell> : null}
          </Section>
          <Section header={t.top}>
            {s.top.length ? s.top.map((x, i) => <Cell key={i} after={<Info type="text">{fmt(x.qty)}</Info>}>{x.dish}</Cell>) : <Cell>{t.noData}</Cell>}
          </Section>
          <Section header={t.funnel}>
            {[[t.fView, s.funnel.view], [t.fCart, s.funnel.cart], [t.fCheckout, s.funnel.checkout], [t.fDone, done]].map(([label, n], i) => (
              <Cell key={i} after={<Info type="text">{fmt(n)}</Info>}>{label}</Cell>
            ))}
          </Section>
        </>
      )}
    </List>
  );
}

/* ---------- сотрудники ---------- */

export function StaffScreen({ ctx }) {
  const { t } = ctx;
  const [d, setD] = useState(null);
  const [link, setLink] = useState('');
  useEffect(() => { api('staff').then(setD).catch((e) => ctx.fail(e)); }, []);
  const invite = async () => {
    const r = await ctx.run(() => api('staff/invite', {}));
    if (r) setLink(r.link);
  };
  const remove = async (s) => {
    if (!(await confirmBox(t.removeStaff(s.name)))) return;
    const r = await ctx.run(() => api('staff/remove', { id: s.id }));
    if (r) setD(r);
  };
  const share = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Buddy Coffee')}`;
    if (native) WA.openTelegramLink(url);
    else window.open(url);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); ctx.toast(t.copied); } catch (e) { window.prompt('', link); }
  };
  if (!d) return <div className="center"><Spinner size="m" /></div>;
  return (
    <List>
      <Section header={t.owners} footer={t.ownersHint}>
        {d.owners.map((o) => <Cell key={o.id} before={<Ico e="👑" />} subtitle={o.username ? '@' + o.username : undefined}>{o.name}</Cell>)}
      </Section>
      <Section header={t.staffList} footer={t.staffHint}>
        {d.staff.length ? d.staff.map((s) => (
          <Cell key={s.id} before={<Ico e="🧑‍🍳" />} subtitle={s.username ? '@' + s.username : undefined}
            after={<Button size="s" mode="plain" onClick={() => remove(s)}>{t.delete}</Button>}>{s.name}</Cell>
        )) : <Cell>{t.noStaff}</Cell>}
        <ButtonCell before={<Ico e="➕" />} onClick={invite}>{t.invite}</ButtonCell>
      </Section>
      {link ? (
        <Section footer={t.inviteReady}>
          <Cell multiline className="mono">{link}</Cell>
          <ButtonCell before={<Ico e="✈️" />} onClick={share}>{t.share}</ButtonCell>
          <ButtonCell before={<Ico e="📋" />} onClick={copy}>{t.copy}</ButtonCell>
        </Section>
      ) : null}
    </List>
  );
}

/* ---------- история изменений ---------- */

export function HistoryScreen({ ctx }) {
  const { t, lang } = ctx;
  const [items, setItems] = useState(null);
  const load = () => api('history').then((r) => setItems(r.items)).catch((e) => ctx.fail(e));
  useEffect(() => { load(); }, []);
  const undo = async (h) => {
    if (!(await confirmBox(t.undoConfirm))) return;
    const r = await ctx.run(() => api('undo', { id: h.id }));
    if (r) { ctx.setSt(r); ctx.toast(t.undone); load(); }
  };
  if (!items) return <div className="center"><Spinner size="m" /></div>;
  if (!items.length) return <Placeholder header={t.histEmpty}><span className="big" aria-hidden="true">🕘</span></Placeholder>;
  return (
    <List>
      <Section header={t.history}>
        {items.map((h) => (
          <Cell key={h.id} multiline subtitle={`${h.by_name || ''} · ${when(h.at, lang)}${h.undone_at ? ` · ${t.undone}` : ''}`}
            after={!h.undone_at && h.undoable && h.kind !== 'undo' ? <Button size="s" mode="plain" onClick={() => undo(h)}>{t.undo}</Button> : undefined}>
            {`${t.kinds[h.kind] || h.kind}${h.title ? ': ' + (h.kind === 'settings' ? h.title.split(', ').map((k) => t.fields[k] || k).join(', ') : h.title) : ''}`}
          </Cell>
        ))}
      </Section>
    </List>
  );
}
