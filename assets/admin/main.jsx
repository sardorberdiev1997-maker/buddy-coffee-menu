// Панель владельца Buddy Coffee — Telegram Mini App (docs/admin-panel.md).
// UI — @telegram-apps/telegram-ui (списки и ячейки как в настройках Telegram), кнопки — родные MainButton/BackButton.
import { AppRoot, Button, Cell, Info, List, Placeholder, Section, SegmentedControl, Snackbar, Spinner, Switch } from '@telegram-apps/telegram-ui';
import '@telegram-apps/telegram-ui/dist/styles.css';
import 'leaflet/dist/leaflet.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import './admin.css';
import { TEXTS } from './i18n.js';
import { api, confirmBox, errorText, haptic, inTelegram, native, nameOf, WA } from './lib.js';
import { ClientCard, ClientsScreen } from './clients.jsx';
import { CatForm, CatsScreen, ItemScreen, MenuScreen } from './menu.jsx';
import { BroadcastScreen, HistoryScreen, InfoScreen, PromoScreen, ScheduleScreen, StaffScreen, StatsScreen } from './more.jsx';
import { Ico, tap } from './ui.jsx';

const SCREENS = {
  menu: MenuScreen, item: ItemScreen, cats: CatsScreen, cat: CatForm, info: InfoScreen, schedule: ScheduleScreen,
  promo: PromoScreen, broadcast: BroadcastScreen, stats: StatsScreen, staff: StaffScreen, history: HistoryScreen,
  clients: ClientsScreen, client: ClientCard
};

const LANG_KEY = 'buddy-admin:lang';
function startLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'uz' || saved === 'ru') return saved;
  } catch (e) { /* приватный режим */ }
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'uz' || q === 'ru') return q;
  const tl = WA && WA.initDataUnsafe && WA.initDataUnsafe.user && WA.initDataUnsafe.user.language_code;
  return /^ru/i.test(tl || '') ? 'ru' : 'uz';
}

function Home({ ctx }) {
  const { st, t } = ctx;
  const L = st.live;
  const [home, setHome] = useState(null);
  useEffect(() => {
    if (native && WA.isVersionAtLeast('8.0')) WA.checkHomeScreenStatus((s) => setHome(s));
  }, []);
  const act = (path, body) => ctx.run(() => api(path, body)).then((r) => r && ctx.setSt(r));
  const rush = L.rush ? L.rush.add : 0;
  return (
    <List>
      <Section header={t.status}>
        <Cell Component="label" multiline
          after={<Switch aria-label={t.acceptOrders} checked={!L.paused && !L.closed} disabled={L.closed} onChange={(e) => act('paused', { on: !e.target.checked })} />}
          subtitle={L.closed ? t.closedToday : L.paused ? t.pausedSub : t.acceptingSub}>{t.acceptOrders}</Cell>
        <Cell Component="label" multiline after={<Switch aria-label={t.closedToday} checked={L.closed} onChange={(e) => act('closed', { on: e.target.checked })} />}
          description={t.closedSub}>{t.closedToday}</Cell>
      </Section>
      <Section header={t.rush} footer={t.rushSub}>
        <div className="pad">
          <SegmentedControl>
            {[0, 15, 30].map((a) => (
              <SegmentedControl.Item key={a} selected={rush === a} onClick={() => act('rush', { add: a })}>{a ? `+${a}` : t.rushOff}</SegmentedControl.Item>
            ))}
          </SegmentedControl>
        </div>
      </Section>
      <Section header={t.sections}>
        <Cell before={<Ico e="🍔" />} after={<Info type="text">{st.doc.items.length}</Info>} {...tap(() => ctx.push('menu'))}>{t.menu}</Cell>
        <Cell before={<Ico e="ℹ️" />} {...tap(() => ctx.push('info'))}>{t.info}</Cell>
        <Cell before={<Ico e="🗓" />} {...tap(() => ctx.push('schedule'))}>{t.schedule}</Cell>
        <Cell before={<Ico e="🏷" />} {...tap(() => ctx.push('promo'))}>{t.promo}</Cell>
      </Section>
      <Section header={t.more}>
        <Cell before={<Ico e="👤" />} {...tap(() => ctx.push('clients'))}>{t.clients}</Cell>
        <Cell before={<Ico e="📊" />} {...tap(() => ctx.push('stats'))}>{t.stats}</Cell>
        <Cell before={<Ico e="📣" />} {...tap(() => ctx.push('broadcast'))}>{t.broadcast}</Cell>
        <Cell before={<Ico e="👥" />} {...tap(() => ctx.push('staff'))}>{t.staff}</Cell>
        <Cell before={<Ico e="🕘" />} {...tap(() => ctx.push('history'))}>{t.history}</Cell>
      </Section>
      {home && home !== 'unsupported' ? (
        <Section>
          <Cell before={<Ico e="📲" />} multiline subtitle={home === 'added' ? t.homeAdded : t.homeScreenSub}
            {...tap(() => home !== 'added' && WA.addToHomeScreen())}>{t.homeScreen}</Cell>
        </Section>
      ) : null}
      <LangSwitch ctx={ctx} />
    </List>
  );
}

function LangSwitch({ ctx }) {
  return (
    <Section header={ctx.t.lang}>
      <div className="pad">
        <SegmentedControl>
          {[['uz', 'O‘zbekcha'], ['ru', 'Русский']].map(([l, label]) => (
            <SegmentedControl.Item key={l} selected={ctx.lang === l} onClick={() => ctx.setLang(l)}>{label}</SegmentedControl.Item>
          ))}
        </SegmentedControl>
      </div>
      <Cell before={<Ico e="🌐" />} {...tap(() => (native ? WA.openLink(ctx.st.site) : window.open(ctx.st.site)))}>{ctx.t.site}</Cell>
    </Section>
  );
}

// Сотрудник: только «нет сегодня» и час пик
function StaffHome({ ctx }) {
  const { st, t, lang } = ctx;
  const stop = st.live.stop || {};
  const act = (path, body) => ctx.run(() => api(path, body)).then((r) => r && ctx.setSt(r));
  const rush = st.live.rush ? st.live.rush.add : 0;
  return (
    <List>
      <Section header={t.rush} footer={t.rushSub}>
        <div className="pad">
          <SegmentedControl>
            {[0, 15, 30].map((a) => (
              <SegmentedControl.Item key={a} selected={rush === a} onClick={() => act('rush', { add: a })}>{a ? `+${a}` : t.rushOff}</SegmentedControl.Item>
            ))}
          </SegmentedControl>
        </div>
      </Section>
      {st.doc.cats.map((c) => {
        const items = st.doc.items.filter((x) => x.cat === c.id && x.avail);
        if (!items.length) return null;
        return (
          <Section key={c.id} header={`${c.icon || ''} ${nameOf(c, lang)}`.trim()} footer={c === st.doc.cats[0] ? t.staffHomeSub : undefined}>
            {items.map((it) => (
              <Cell key={it.key} Component="label" after={<Switch aria-label={nameOf(it, lang)} checked={!stop[it.key]} onChange={(e) => act('stop', { key: it.key, on: !e.target.checked })} />}
                description={stop[it.key] ? t.notToday : undefined}>{nameOf(it, lang)}</Cell>
            ))}
          </Section>
        );
      })}
      <LangSwitch ctx={ctx} />
    </List>
  );
}

function App() {
  const [lang, setLangState] = useState(startLang);
  const [st, setSt] = useState(null);
  const [error, setError] = useState(null);
  const [stack, setStack] = useState([{ name: 'home', params: {} }]);
  const [toast, setToast] = useState(null);
  const dirty = useRef(false);
  const t = TEXTS[lang];

  const load = useCallback(() => api('state').then((s) => { setSt(s); setError(null); }).catch((e) => setError(e)), []);
  useEffect(() => {
    if (!inTelegram) return;
    WA.ready();
    WA.expand();
    if (WA.isVersionAtLeast('7.7')) WA.disableVerticalSwipes(); // формы прокручиваются, а не сворачивают панель
    load();
    const onVisible = () => { if (document.visibilityState === 'visible' && !dirty.current) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const setDirty = useCallback((v) => {
    dirty.current = !!v;
    if (native) (v ? WA.enableClosingConfirmation() : WA.disableClosingConfirmation());
  }, []);

  const push = useCallback((name, params = {}) => { setStack((s) => [...s, { name, params }]); window.scrollTo(0, 0); }, []);
  const pop = useCallback(async (force) => {
    if (!force && dirty.current) {
      if (!(await confirmBox(TEXTS[lang].unsaved))) return;
    }
    setDirty(false);
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, [lang, setDirty]);

  // Кнопка «Назад» Telegram
  const popRef = useRef(pop);
  popRef.current = pop;
  useEffect(() => {
    if (!native) return undefined;
    const h = () => popRef.current();
    WA.BackButton.onClick(h);
    return () => WA.BackButton.offClick(h);
  }, []);
  useEffect(() => {
    if (native) (stack.length > 1 ? WA.BackButton.show() : WA.BackButton.hide());
  }, [stack.length]);

  const fail = useCallback((e) => {
    haptic('err');
    setToast({ id: Date.now(), msg: errorText(TEXTS[lang], e) });
    if (e && (e.code === 'conflict' || e.code === 'gone')) load();
  }, [lang, load]);

  // Действие с сервером: ошибка — во всплывающее сообщение, успех — вибрация
  const run = useCallback(async (fn) => {
    try {
      const r = await fn();
      haptic('ok');
      return r;
    } catch (e) {
      fail(e);
      return null;
    }
  }, [fail]);

  const setLang = (l) => {
    setLangState(l);
    try { localStorage.setItem(LANG_KEY, l); } catch (e) { /* приватный режим */ }
  };

  const ctx = {
    st, setSt, t, lang, setLang, push, pop, setDirty, run, fail, reload: load,
    toast: (msg, opts = {}) => setToast({ id: Date.now(), msg, ...opts })
  };

  let body;
  if (!inTelegram) body = <Placeholder header={t.openInTg} description={t.openInTgSub}><span className="big" aria-hidden="true">⚙️</span></Placeholder>;
  else if (error && error.code === 'forbidden') body = <Placeholder header={t.noAccess} description={t.noAccessSub}><span className="big" aria-hidden="true">🔒</span></Placeholder>;
  else if (error && !st) body = <Placeholder header={errorText(t, error)} action={<Button size="m" onClick={load}>↻</Button>} />;
  else if (!st) body = <div className="center"><Spinner size="l" /></div>;
  else if (st.me.role !== 'owner') body = <StaffHome ctx={ctx} />;
  else {
    const top = stack[stack.length - 1];
    const Screen = SCREENS[top.name] || Home;
    body = <Screen key={stack.length + top.name} ctx={ctx} params={top.params} />;
  }

  return (
    <AppRoot appearance={WA && WA.colorScheme === 'dark' ? 'dark' : 'light'} platform={WA && ['ios', 'macos'].includes(WA.platform) ? 'ios' : 'base'}>
      {!native && stack.length > 1 ? <div className="backbar"><Button mode="plain" size="s" onClick={() => pop()}>← {t.back}</Button></div> : null}
      <main>{body}</main>
      {toast ? (
        <Snackbar key={toast.id} onClose={() => setToast(null)} duration={toast.undo ? 6000 : 3500}
          after={toast.undo ? <Snackbar.Button onClick={async () => {
            setToast(null);
            const r = await run(() => api('undo', { id: toast.undo }));
            if (r) { setSt(r); setToast({ id: Date.now(), msg: t.undone }); }
          }}>{t.undo}</Snackbar.Button> : undefined}>{toast.msg}</Snackbar>
      ) : null}
    </AppRoot>
  );
}

createRoot(document.getElementById('root')).render(<App />);
