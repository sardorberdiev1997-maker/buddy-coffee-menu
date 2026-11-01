// Мелкие общие элементы экранов панели
import { Button, FixedLayout } from '@telegram-apps/telegram-ui';

import { imgUrl } from './lib.js';

// Нажимаемая ячейка списка: для экранных дикторов и клавиатуры — кнопка (Cell telegram-ui рисует div)
export const tap = (fn) => ({
  onClick: fn, role: 'button', tabIndex: 0,
  onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } }
});

export const Ico = ({ e }) => <span className="ico" aria-hidden="true">{e}</span>;

// Своя нижняя кнопка — только вне Telegram (в Telegram — родная MainButton, см. useMainButton)
export const Bottom = ({ btn }) => (btn ? (
  <FixedLayout vertical="bottom" className="bottom">
    <Button size="l" stretched onClick={btn.onClick} disabled={btn.disabled} loading={btn.loading}>{btn.text}</Button>
  </FixedLayout>
) : null);

// Поле формы с подписью сверху (подписи telegram-ui на iOS не показываются) и подсказкой или ошибкой снизу
export const Field = ({ label, hint, error, children }) => (
  <div className="fld">
    {label ? <div className="fld__l">{label}</div> : null}
    {children}
    {error ? <div className="fld__e" role="alert">{error}</div> : hint ? <div className="fld__h">{hint}</div> : null}
  </div>
);

export const Thumb = ({ img, preview, size = 44, icon = '🍽' }) => {
  const src = preview || imgUrl(img);
  return src
    ? <img className="thumb" src={src} width={size} height={size} alt="" loading="lazy" />
    : <span className="thumb thumb--empty" style={{ width: size, height: size }} aria-hidden="true">{icon}</span>;
};
