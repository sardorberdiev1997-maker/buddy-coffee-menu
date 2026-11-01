// Экраны меню: список блюд, карточка блюда, разделы
import { ButtonCell, Cell, Chip, IconButton, Input, List, Section, Select, Switch, Textarea } from '@telegram-apps/telegram-ui';
import { useEffect, useMemo, useRef, useState } from 'react';

import { api, confirmBox, fmt, haptic, imgUrl, nameOf, num, otherLang, todayKey, uploadPhoto, useMainButton } from './lib.js';
import { Bottom, Field, Ico, tap, Thumb } from './ui.jsx';

const priceText = (it, t) => {
  const v = it.variants || [];
  if (!v.length) return '';
  const p = v.map((x) => x.price).filter(Boolean);
  return (p.length > 1 ? `${fmt(Math.min(...p))}–${fmt(Math.max(...p))}` : fmt(p[0])) + ' ' + (t.lang === 'ru' ? 'сум' : 'so‘m');
};

// Меняем местами блюдо с соседом из того же раздела
function moved(items, key, dir) {
  const keys = items.map((x) => x.key);
  const i = keys.indexOf(key);
  const cat = items[i].cat;
  let j = i + dir;
  while (j >= 0 && j < items.length && items[j].cat !== cat) j += dir;
  if (j < 0 || j >= items.length) return null;
  [keys[i], keys[j]] = [keys[j], keys[i]];
  return keys;
}

export function MenuScreen({ ctx }) {
  const { st, t, lang } = ctx;
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [order, setOrder] = useState(false);
  const stop = st.live.stop || {};
  const btn = useMainButton({ text: t.addDish, onClick: () => ctx.push('item', { cat: cat || (st.doc.cats[0] || {}).id }), visible: !order });
  const needle = q.trim().toLowerCase();
  const match = (it) => !needle || `${it.uz} ${it.ru}`.toLowerCase().includes(needle);
  const act = (path, body) => ctx.run(() => api(path, body)).then((r) => r && ctx.setSt(r));
  const lt = { ...t, lang };
  return (
    <List>
      <div className="pad">
        <Input before={<span aria-hidden="true">🔍</span>} placeholder={t.search} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="chips" role="tablist">
        {[{ id: '', icon: '', uz: t.all, ru: t.all }, ...st.doc.cats].map((c) => (
          <Chip key={c.id || 'all'} mode={cat === c.id ? 'elevated' : 'outline'} {...tap(() => setCat(c.id))} role="tab" aria-selected={cat === c.id}>
            {`${c.icon || ''} ${nameOf(c, lang)}`.trim()}
          </Chip>
        ))}
      </div>
      {st.doc.cats.filter((c) => !cat || c.id === cat).map((c, ci) => {
        const items = st.doc.items.filter((x) => x.cat === c.id && match(x));
        if (!items.length && (needle || cat !== c.id)) return null;
        return (
          <Section key={c.id} header={`${c.icon || ''} ${nameOf(c, lang)}`.trim()} footer={ci === 0 && !order ? t.inStockHint : undefined}>
            {items.map((it) => {
              const off = !!stop[it.key];
              return (
                <Cell key={it.key} className="row" before={<Thumb img={it.img} icon={c.icon || '🍽'} />}
                  subtitle={priceText(it, lt)} description={!it.avail ? t.notInMenu : off ? t.notToday : undefined}
                  after={order ? (
                    <span className="arrows">
                      <IconButton size="s" mode="plain" aria-label="↑" onClick={() => { const k = moved(st.doc.items, it.key, -1); if (k) act('order', { kind: 'items', keys: k }); }}>↑</IconButton>
                      <IconButton size="s" mode="plain" aria-label="↓" onClick={() => { const k = moved(st.doc.items, it.key, 1); if (k) act('order', { kind: 'items', keys: k }); }}>↓</IconButton>
                    </span>
                  ) : (
                    <span className="row__over">
                      <Switch aria-label={`${t.today}: ${nameOf(it, lang)}`} checked={it.avail && !off} disabled={!it.avail} onChange={(e) => act('stop', { key: it.key, on: !e.target.checked })} />
                    </span>
                  )}>{order ? nameOf(it, lang) : <button type="button" className="row__open" onClick={() => ctx.push('item', { key: it.key })}>{nameOf(it, lang)}</button>}</Cell>
              );
            })}
          </Section>
        );
      })}
      <Section>
        <ButtonCell before={<Ico e="📂" />} onClick={() => ctx.push('cats')}>{t.cats}</ButtonCell>
        <ButtonCell before={<Ico e="↕️" />} onClick={() => setOrder(!order)}>{order ? t.reorderDone : t.reorder}</ButtonCell>
      </Section>
      <div className="spacer" />
      <Bottom btn={btn} />
    </List>
  );
}

const BLANK_VARIANT = { size_uz: '', size_ru: '', price: '', old: '', weight: '' };

export function ItemScreen({ ctx, params }) {
  const { st, t, lang } = ctx;
  const other = otherLang(lang);
  const orig = params.key ? st.doc.items.find((x) => x.key === params.key) : null;
  const blank = useMemo(() => ({
    cat: params.cat || (st.doc.cats[0] || {}).id || '', uz: '', ru: '', desc_uz: '', desc_ru: '', img: '', badge: '', avail: true,
    weight: '', pairs: '', kcal: '', protein: '', fat: '', carbs: '', allergens: '', variants: [{ ...BLANK_VARIANT }]
  }), []);
  const start = useMemo(() => (orig ? JSON.parse(JSON.stringify(orig)) : blank), []);
  const [f, setF] = useState(start);
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState({ busy: false, preview: '' });
  const [more, setMore] = useState(false);
  const file = useRef(null);
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  useEffect(() => { ctx.setDirty(dirty); }, [dirty]);

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const setV = (i, k, v) => setF((p) => ({ ...p, variants: p.variants.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));
  const many = f.variants.length > 1;
  const stop = st.live.stop || {};
  const today = todayKey();
  const isDay = !!(orig && st.doc.promo && st.doc.promo.day && st.doc.promo.day.key === orig.key && st.doc.promo.day.date === today);

  const validate = () => {
    const e = {};
    if (!f.uz.trim() && !f.ru.trim()) e.name = t.errName;
    f.variants.forEach((v, i) => {
      if (!(num(v.price) > 0)) e['p' + i] = t.errPrice;
      if (many && !v.size_uz.trim() && !v.size_ru.trim()) e['s' + i] = t.errSize;
    });
    setErrs(e);
    return !Object.keys(e).length;
  };

  const save = async () => {
    if (!validate()) { haptic('err'); return; }
    setBusy(true);
    try {
      const r = await api('item', {
        ...f, key: orig ? orig.key : undefined, rev: orig ? orig.rev : undefined,
        variants: f.variants.map((v) => ({ ...v, price: num(v.price), old: num(v.old) }))
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
  const btn = useMainButton({ text: t.save, onClick: save, active: dirty, progress: busy || photo.busy });

  const pick = async (e) => {
    const fl = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!fl) return;
    setPhoto({ busy: true, preview: '' });
    try {
      const r = await uploadPhoto(fl);
      set('img', r.img);
      setPhoto({ busy: false, preview: r.preview });
    } catch (err) {
      setPhoto({ busy: false, preview: '' });
      ctx.fail(err.code ? err : { code: 'bad_image' });
    }
  };

  const remove = async () => {
    if (!(await confirmBox(t.confirmDelete(nameOf(orig, lang))))) return;
    const r = await ctx.run(() => api('item/delete', { key: orig.key, rev: orig.rev }));
    if (r) { ctx.setDirty(false); ctx.setSt(r); ctx.toast(t.saved, { undo: r.change }); ctx.pop(true); }
  };
  const act = (path, body) => ctx.run(() => api(path, body)).then((r) => r && ctx.setSt(r));

  const nameMine = f[lang], nameOther = f[other];
  const cat = st.doc.cats.find((c) => c.id === f.cat);
  const src = photo.preview || imgUrl(f.img, 'l');
  return (
    <List>
      <Section header={orig ? t.editDish : t.newDish}>
        <div className="photo">
          {src ? <img src={src} alt="" /> : <span className="photo__empty" aria-hidden="true">{(cat && cat.icon) || '📷'}</span>}
        </div>
        <input ref={file} type="file" accept="image/*" hidden onChange={pick} />
        <ButtonCell before={<Ico e="📷" />} onClick={() => file.current.click()} disabled={photo.busy}>
          {photo.busy ? t.photoBusy : f.img ? t.photoChange : t.photoAdd}
        </ButtonCell>
        {f.img ? <ButtonCell before={<Ico e="🗑" />} mode="destructive" onClick={() => { set('img', ''); setPhoto({ busy: false, preview: '' }); }}>{t.photoRemove}</ButtonCell> : null}
        <div className="hint">{t.photoHint}</div>
      </Section>

      <Section>
        <Field label={t.nameMine} error={errs.name}>
          <Input value={nameMine} status={errs.name ? 'error' : undefined} onChange={(e) => set(lang, e.target.value)} maxLength={80} />
        </Field>
        <Field label={t.nameOther} hint={t.otherHint}>
          <Input value={nameOther} onChange={(e) => set(other, e.target.value)} maxLength={80} />
        </Field>
        <Field label={t.cat}>
          <Select value={f.cat} onChange={(e) => set('cat', e.target.value)}>
            {st.doc.cats.map((c) => <option key={c.id} value={c.id}>{`${c.icon || ''} ${nameOf(c, lang)}`.trim()}</option>)}
          </Select>
        </Field>
      </Section>

      {f.variants.map((v, i) => (
        <Section key={i} header={many ? t.sizeN(i + 1) : t.price}>
          {many ? (
            <div className="row2">
              <Field label={t.sizeMine} error={errs['s' + i]}>
                <Input value={v['size_' + lang]} onChange={(e) => setV(i, 'size_' + lang, e.target.value)} maxLength={30} placeholder={lang === 'ru' ? 'Маленький' : 'Kichik'} />
              </Field>
              <Field label={t.sizeOther}>
                <Input value={v['size_' + other]} onChange={(e) => setV(i, 'size_' + other, e.target.value)} maxLength={30} />
              </Field>
            </div>
          ) : null}
          <div className="row2">
            <Field label={t.price} error={errs['p' + i]}>
              <Input inputMode="numeric" value={v.price === '' ? '' : fmt(num(v.price))} status={errs['p' + i] ? 'error' : undefined}
                onChange={(e) => setV(i, 'price', e.target.value.replace(/[^\d]/g, ''))} placeholder="35 000" />
            </Field>
            <Field label={t.oldPrice}>
              <Input inputMode="numeric" value={!v.old ? '' : fmt(num(v.old))} onChange={(e) => setV(i, 'old', e.target.value.replace(/[^\d]/g, ''))} />
            </Field>
          </div>
          <Field label={t.weight} hint={i === f.variants.length - 1 ? t.oldHint : undefined}>
            <Input value={v.weight} onChange={(e) => setV(i, 'weight', e.target.value)} maxLength={20} placeholder="250 g" />
          </Field>
          {many ? <ButtonCell mode="destructive" onClick={() => setF((p) => ({ ...p, variants: p.variants.filter((_, j) => j !== i) }))}>{t.removeSize}</ButtonCell> : null}
        </Section>
      ))}
      <Section>
        <ButtonCell before={<Ico e="➕" />} onClick={() => setF((p) => ({ ...p, variants: [...p.variants, { ...BLANK_VARIANT }] }))} disabled={f.variants.length >= 6}>
          {many ? t.addSize : t.manySizes}
        </ButtonCell>
      </Section>

      <Section header={t.badge}>
        <div className="chips chips--wrap">
          {['', 'хит', 'новинка', 'острое', 'советуем'].map((b) => (
            <Chip key={b || 'none'} mode={f.badge === b ? 'elevated' : 'outline'} {...tap(() => set('badge', b))} aria-pressed={f.badge === b}>
              {b ? t.badges[b] : t.badgeNone}
            </Chip>
          ))}
        </div>
      </Section>

      <Section>
        <Field label={t.descMine}>
          <Textarea value={f['desc_' + lang]} onChange={(e) => set('desc_' + lang, e.target.value)} maxLength={300} />
        </Field>
        <Field label={t.descOther}>
          <Textarea value={f['desc_' + other]} onChange={(e) => set('desc_' + other, e.target.value)} maxLength={300} />
        </Field>
      </Section>

      <Section header={t.availability}>
        <Cell Component="label" multiline description={t.inMenuSub} after={<Switch aria-label={t.inMenu} checked={f.avail} onChange={(e) => set('avail', e.target.checked)} />}>{t.inMenu}</Cell>
        {orig ? (
          <Cell Component="label" multiline description={t.todaySub}
            after={<Switch aria-label={t.today} checked={!stop[orig.key]} onChange={(e) => act('stop', { key: orig.key, on: !e.target.checked })} />}>{t.today}</Cell>
        ) : null}
      </Section>

      {orig ? (
        <Section header={t.dayDish} footer={t.dayHint}>
          <Cell Component="label" after={<Switch aria-label={isDay ? t.isDay : t.makeDay} checked={isDay} onChange={(e) => act('promo', { day: e.target.checked ? orig.key : null })} />}>
            {isDay ? t.isDay : t.makeDay}
          </Cell>
        </Section>
      ) : null}

      <Section>
        {/* Раскрывающийся блок по схеме WAI «disclosure»: кнопка с aria-expanded, скрытые поля не остаются в DOM.
            (Accordion из telegram-ui оставляет свёрнутые поля доступными с клавиатуры) */}
        <ButtonCell before={<Ico e="🧾" />} after={<span className={more ? 'chev chev--open' : 'chev'} aria-hidden="true">›</span>}
          aria-expanded={more} aria-controls="item-more" onClick={() => setMore(!more)}>{t.details}</ButtonCell>
        {more ? (
          <div id="item-more">
            <Field label={t.pairs}><Input value={f.pairs} onChange={(e) => set('pairs', e.target.value)} maxLength={200} placeholder="Kartoshka fri / Mojito" /></Field>
            <Field label={t.allergens}><Input value={f.allergens} onChange={(e) => set('allergens', e.target.value)} maxLength={200} placeholder="глютен, яйца" /></Field>
            <Field label={t.kcal} hint={many ? t.nutrHint : undefined}><Input value={f.kcal} onChange={(e) => set('kcal', e.target.value)} maxLength={40} /></Field>
            <Field label={t.protein}><Input value={f.protein} onChange={(e) => set('protein', e.target.value)} maxLength={40} /></Field>
            <Field label={t.fat}><Input value={f.fat} onChange={(e) => set('fat', e.target.value)} maxLength={40} /></Field>
            <Field label={t.carbs}><Input value={f.carbs} onChange={(e) => set('carbs', e.target.value)} maxLength={40} /></Field>
          </div>
        ) : null}
      </Section>

      <Section header={t.preview}>
        <Preview f={f} src={photo.preview || imgUrl(f.img)} t={t} lang={lang} icon={cat && cat.icon} day={isDay} />
      </Section>

      {orig ? (
        <Section>
          <ButtonCell before={<Ico e="🗑" />} mode="destructive" onClick={remove}>{t.deleteDish}</ButtonCell>
        </Section>
      ) : null}
      <div className="spacer" />
      <Bottom btn={btn} />
    </List>
  );
}

// Карточка «как увидят гости» — упрощённо, по образцу карточки сайта
function Preview({ f, src, t, lang, icon, day }) {
  const name = f[lang] || f[otherLang(lang)] || '—';
  const desc = f['desc_' + lang] || f['desc_' + otherLang(lang)];
  const badge = day ? t.dayDish : f.badge ? t.badges[f.badge] : '';
  const cur = lang === 'ru' ? 'сум' : 'so‘m';
  return (
    <div className={`pv${f.avail ? '' : ' pv--out'}`}>
      <div className="pv__img">{src ? <img src={src} alt="" /> : <span aria-hidden="true">{icon || '🍽'}</span>}{badge ? <span className="pv__badge">{badge}</span> : null}</div>
      <div className="pv__body">
        <b>{name}</b>
        {desc ? <small>{desc}</small> : null}
        <div className="pv__prices">
          {f.variants.map((v, i) => (
            <span key={i} className="pv__price">
              {f.variants.length > 1 ? <small>{v['size_' + lang] || v['size_' + otherLang(lang)]}</small> : null}
              {num(v.old) > num(v.price) ? <s>{fmt(num(v.old))}</s> : null}
              {num(v.price) ? `${fmt(num(v.price))} ${cur}` : '—'}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CatsScreen({ ctx }) {
  const { st, t, lang } = ctx;
  const btn = useMainButton({ text: t.addCat, onClick: () => ctx.push('cat', {}) });
  const act = (body) => ctx.run(() => api('order', body)).then((r) => r && ctx.setSt(r));
  const move = (i, dir) => {
    const keys = st.doc.cats.map((c) => c.id);
    const j = i + dir;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    act({ kind: 'cats', keys });
  };
  return (
    <List>
      <Section header={t.cats}>
        {st.doc.cats.map((c, i) => (
          <Cell key={c.id} before={<Ico e={c.icon || '📂'} />} {...tap(() => ctx.push('cat', { id: c.id }))}
            subtitle={t.dishes(st.doc.items.filter((x) => x.cat === c.id).length)}
            after={(
              <span className="arrows" onClick={(e) => e.stopPropagation()}>
                <IconButton size="s" mode="plain" aria-label="↑" disabled={i === 0} onClick={() => move(i, -1)}>↑</IconButton>
                <IconButton size="s" mode="plain" aria-label="↓" disabled={i === st.doc.cats.length - 1} onClick={() => move(i, 1)}>↓</IconButton>
              </span>
            )}>{nameOf(c, lang)}</Cell>
        ))}
      </Section>
      <div className="spacer" />
      <Bottom btn={btn} />
    </List>
  );
}

export function CatForm({ ctx, params }) {
  const { st, t, lang } = ctx;
  const other = otherLang(lang);
  const orig = params.id ? st.doc.cats.find((c) => c.id === params.id) : null;
  const start = useMemo(() => (orig ? { ...orig } : { uz: '', ru: '', icon: '', pairs: '' }), []);
  const [f, setF] = useState(start);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  useEffect(() => { ctx.setDirty(dirty); }, [dirty]);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!f.uz.trim() && !f.ru.trim()) { setErr(t.errName); haptic('err'); return; }
    setBusy(true);
    try {
      const r = await api('cat', { ...f, id: orig ? orig.id : undefined, rev: orig ? orig.rev : undefined });
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
  const count = orig ? st.doc.items.filter((x) => x.cat === orig.id).length : 0;
  const remove = async () => {
    if (count) { ctx.toast(t.catNotEmpty); return; }
    if (!(await confirmBox(t.confirmDelete(nameOf(orig, lang))))) return;
    const r = await ctx.run(() => api('cat/delete', { id: orig.id }));
    if (r) { ctx.setDirty(false); ctx.setSt(r); ctx.toast(t.saved, { undo: r.change }); ctx.pop(true); }
  };
  return (
    <List>
      <Section header={orig ? t.catEdit : t.catNew}>
        <Field label={t.catMine} error={err}><Input value={f[lang]} onChange={(e) => { set(lang, e.target.value); setErr(''); }} maxLength={40} /></Field>
        <Field label={t.catOther} hint={t.otherHint}><Input value={f[other]} onChange={(e) => set(other, e.target.value)} maxLength={40} /></Field>
        <Field label={t.icon}><Input value={f.icon} onChange={(e) => set('icon', e.target.value)} maxLength={8} placeholder="🍕" /></Field>
        <Field label={t.catPairs}><Input value={f.pairs} onChange={(e) => set('pairs', e.target.value)} maxLength={200} placeholder="Mojito / Limonad" /></Field>
      </Section>
      {orig ? (
        <Section footer={count ? t.catNotEmpty : undefined}>
          <ButtonCell before={<Ico e="🗑" />} mode="destructive" onClick={remove}>{t.deleteCat}</ButtonCell>
        </Section>
      ) : null}
      <div className="spacer" />
      <Bottom btn={btn} />
    </List>
  );
}
