// Раздел «Клиенты» (CRM): список с поиском и сегментами, карточка клиента, заметка, выгрузка, удаление по просьбе.
// Только владельцам — сервер проверяет права (server/admin.js)
import { Avatar, Button, ButtonCell, Cell, Chip, Info, Input, List, Placeholder, Section, Select, Spinner, Textarea } from '@telegram-apps/telegram-ui';
import { useEffect, useMemo, useRef, useState } from 'react';

import { api, confirmBox, fmt, haptic, native, useMainButton, WA, when } from './lib.js';
import { Bottom, Field, Ico, tap } from './ui.jsx';

const SEGS = ['all', 'vip', 'regular', 'new', 'sleep', 'lost', 'none', 'subs'];
const SORTS = ['last', 'spent', 'orders', 'new', 'name'];
const cur = (lang) => (lang === 'ru' ? 'сум' : 'so‘m');
// Плитки: 1 250 000 → «1,3 млн», чтобы число помещалось в одну строку
const short = (n, T) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} ${T.mln}` : fmt(n));
const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function ClientsScreen({ ctx }) {
  const { t, lang } = ctx;
  const T = t.crm;
  const [q, setQ] = useState('');
  const [seg, setSeg] = useState('all');
  const [sort, setSort] = useState('last');
  const [data, setData] = useState(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  const load = (offset = 0) => {
    const qs = new URLSearchParams({ q, seg, sort, offset: String(offset) });
    return api('clients?' + qs).then((r) => {
      setData((prev) => (offset && prev ? { ...r, items: [...prev.items, ...r.items] } : r));
    }).catch((e) => ctx.fail(e));
  };
  // Поиск — после паузы в наборе, чтобы не дёргать сервер на каждую букву
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => load(0), q ? 300 : 0);
    return () => clearTimeout(timer.current);
  }, [q, seg, sort]);

  const exportXlsx = async () => {
    setBusy(true);
    const r = await ctx.run(() => api('clients/export', {}));
    setBusy(false);
    if (r) ctx.toast(T.exported(r.count));
  };
  const btn = useMainButton({ text: T.export, onClick: exportXlsx, progress: busy });

  const s = data && data.summary;
  return (
    <List>
      {s ? (
        <Section header={T.title}>
          <div className="kpis">
            <div className="kpi"><b>{fmt(s.all)}</b><span>{T.kAll}</span></div>
            <div className="kpi"><b>{fmt(s.buyers)}</b><span>{T.kBuyers}</span></div>
            <div className="kpi"><b>{s.buyers ? Math.round(s.repeat / s.buyers * 100) : 0}%</b><span>{T.kRepeat}</span></div>
            <div className="kpi"><b>{fmt(s.fresh)}</b><span>{T.kFresh}</span></div>
          </div>
        </Section>
      ) : null}
      <div className="pad">
        <Input before={<span aria-hidden="true">🔍</span>} placeholder={T.search} value={q} onChange={(e) => setQ(e.target.value)} inputMode="search" />
      </div>
      <div className="chips" role="tablist" aria-label={T.segments}>
        {SEGS.map((k) => (
          <Chip key={k} mode={seg === k ? 'elevated' : 'outline'} onClick={() => setSeg(k)} role="tab" aria-selected={seg === k}>
            {`${T.seg[k]}${data ? ` · ${data.segCount[k] || 0}` : ''}`}
          </Chip>
        ))}
      </div>
      <Field label={T.sort}>
        <Select value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORTS.map((k) => <option key={k} value={k}>{T.sorts[k]}</option>)}
        </Select>
      </Field>
      {!data ? <div className="center"><Spinner size="m" /></div> : !data.items.length ? (
        <Placeholder header={T.empty} description={q ? T.emptySearch : undefined}><span className="big" aria-hidden="true">👥</span></Placeholder>
      ) : (
        <Section header={T.found(data.total)} footer={T.segHint}>
          {data.items.map((c) => (
            <Cell key={c.id} {...tap(() => ctx.push('client', { id: c.id }))}
              before={<Avatar size={40} acronym={initials(c.name || c.username || c.phone)} />}
              subtitle={c.done ? T.line(c.done, `${fmt(c.spent)} ${cur(lang)}`) : (c.phone || (c.username ? '@' + c.username : T.botOnly))}
              description={c.last_at ? T.lastShort(when(c.last_at, lang).split(',')[0]) : undefined}
              after={<span className={`seg seg--${c.seg}`}>{T.seg[c.seg]}</span>}>
              {`${c.name || c.phone || (c.username ? '@' + c.username : T.noName)}${c.noted ? ' 📝' : ''}`}
            </Cell>
          ))}
          {data.items.length < data.total ? (
            <ButtonCell onClick={async () => { setMore(true); await load(data.items.length); setMore(false); }} disabled={more}>
              {more ? t.loading : T.more(data.total - data.items.length)}
            </ButtonCell>
          ) : null}
        </Section>
      )}
      <div className="spacer" />
      <Bottom btn={btn} />
    </List>
  );
}

export function ClientCard({ ctx, params }) {
  const { t, lang } = ctx;
  const T = t.crm;
  const [c, setC] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('client?id=' + params.id).then((r) => { setC(r); setNote(r.note); }).catch((e) => { ctx.fail(e); ctx.pop(true); });
  }, []);
  const dirty = !!c && note.trim() !== (c.note || '');
  useEffect(() => { ctx.setDirty(dirty); }, [dirty]);
  const saveNote = async () => {
    setBusy(true);
    const r = await ctx.run(() => api('client/note', { id: c.id, note }));
    setBusy(false);
    if (r) { setC(r); setNote(r.note); ctx.setDirty(false); ctx.toast(T.noteSaved); }
  };
  const btn = useMainButton({ text: T.saveNote, onClick: saveNote, visible: dirty, progress: busy });

  const call = () => { window.location.href = 'tel:' + c.tel; };
  const copy = async () => {
    try { await navigator.clipboard.writeText(c.tel); ctx.toast(t.copied); } catch (e) { window.prompt('', c.tel); }
  };
  const forget = async () => {
    if (!(await confirmBox(T.forgetConfirm))) return;
    const r = await ctx.run(() => api('client/forget', { id: c.id }));
    if (r) { ctx.setDirty(false); ctx.toast(T.forgotten(r.orders, r.active)); ctx.pop(true); }
  };
  const days = useMemo(() => (c && c.last_at ? Math.floor((Date.now() - c.last_at) / 86400000) : null), [c]);

  if (!c) return <div className="center"><Spinner size="l" /></div>;
  const subs = { on: T.subsOn, off: T.subsOff, blocked: T.subsBlocked, none: T.subsNone }[c.subs];
  return (
    <List>
      <Section>
        <Cell before={<Avatar size={48} acronym={initials(c.name || c.username || c.phone)} />} multiline
          subtitle={`${T.seg[c.seg]} · ${T.since(when(c.created_at, lang).split(',')[0])}`}>
          {c.name || c.phone || (c.username ? '@' + c.username : T.noName)}
        </Cell>
      </Section>

      <Section header={T.contacts}>
        {c.tel ? (
          <>
            <Cell before={<Ico e="📞" />} after={<Button size="s" mode="bezeled" onClick={call}>{T.call}</Button>}>{c.phone}</Cell>
            <ButtonCell before={<Ico e="📋" />} onClick={copy}>{T.copyPhone}</ButtonCell>
          </>
        ) : null}
        {c.username ? (
          <Cell before={<Ico e="✈️" />} {...tap(() => (native ? WA.openTelegramLink('https://t.me/' + c.username) : window.open('https://t.me/' + c.username)))}
            after={<Info type="text">{T.write}</Info>}>{'@' + c.username}</Cell>
        ) : null}
        <Cell before={<Ico e="🔔" />} multiline subtitle={subs}>{T.subs}</Cell>
        <Cell before={<Ico e="🌐" />} after={<Info type="text">{c.lang === 'ru' ? 'Русский' : 'O‘zbekcha'}</Info>}>{T.lang}</Cell>
        {c.source ? <Cell before={<Ico e="🧭" />} after={<Info type="text">{T.src[c.source] || c.source}</Info>}>{T.source}</Cell> : null}
      </Section>

      <Section header={T.metrics}>
        <div className="kpis kpis--2">
          <div className="kpi"><b>{fmt(c.done)}</b><span>{T.mOrders}</span></div>
          <div className="kpi"><b>{short(c.spent, T)}</b><span>{T.mSpent(cur(lang))}</span></div>
          <div className="kpi"><b>{c.done ? short(c.avg, T) : '—'}</b><span>{T.mAvg}</span></div>
          <div className="kpi"><b>{c.every != null ? T.every(c.every) : '—'}</b><span>{T.mEvery}</span></div>
        </div>
        {c.first_at ? <Cell after={<Info type="text">{when(c.first_at, lang).split(',')[0]}</Info>}>{T.first}</Cell> : null}
        {c.last_at ? <Cell after={<Info type="text">{`${when(c.last_at, lang).split(',')[0]} · ${T.daysAgo(days)}`}</Info>}>{T.last}</Cell> : null}
        {c.fav ? <Cell multiline after={<Info type="text">{c.fav}</Info>}>{T.fav}</Cell> : null}
        {c.done ? <Cell after={<Info type="text">{`${fmt(c.deliveries)} / ${fmt(c.done - c.deliveries)}`}</Info>}>{T.delPick}</Cell> : null}
        {c.canceled ? <Cell after={<Info type="text">{fmt(c.canceled)}</Info>}>{T.canceled}</Cell> : null}
        {c.rating ? <Cell after={<Info type="text">{`★ ${c.rating.avg.toFixed(1)} · ${c.rating.n}`}</Info>}>{T.rating}</Cell> : null}
      </Section>

      <Section header={T.note} footer={c.note_at ? T.noteBy(c.note_by, when(c.note_at, lang)) : T.noteHint}>
        <Field>
          <Textarea value={note} maxLength={500} rows={3} placeholder={T.notePh} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Section>

      <Section header={T.history}>
        {c.orders.length ? c.orders.map((o) => (
          <Cell key={o.id} multiline
            subtitle={`${when(o.at, lang)} · ${o.icon} ${o.label[lang]}${o.stars ? ` · ★${o.stars}` : ''}`}
            description={[o.items, o.review ? `«${o.review}»` : ''].filter(Boolean).join(' — ')}
            after={<Info type="text">{fmt(o.total)}</Info>}>{`№${o.id} · ${o.type === 'delivery' ? T.delivery : T.pickup}`}</Cell>
        )) : <Cell>{T.noOrders}</Cell>}
      </Section>

      <Section footer={T.forgetHint}>
        <ButtonCell before={<Ico e="🗑" />} mode="destructive" onClick={forget}>{T.forget}</ButtonCell>
      </Section>
      <div className="spacer" />
      <Bottom btn={btn} />
    </List>
  );
}
