// Точка кафе на карте: нажать на карту или перетащить метку. Leaflet + OpenStreetMap, грузится только когда карту открыли
// (отдельный файл сборки). Метка — своя, без картинок Leaflet; подпись © OpenStreetMap — условие использования карт OSM
import L from 'leaflet';
import { useEffect, useRef } from 'react';

const parse = (v) => {
  const m = String(v || '').match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  return m ? [+m[1], +m[2]] : null;
};
const SHAHRISABZ = [39.0538, 66.8489];

export default function MapPicker({ value, onChange }) {
  const box = useRef(null);
  const map = useRef(null);
  const pin = useRef(null);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const start = parse(value) || SHAHRISABZ;
    const m = L.map(box.current, { zoomControl: true, attributionControl: true }).setView(start, 17);
    m.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>'); // без флага из стандартной подписи
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      // У страницы панели Referrer-Policy: no-referrer, а серверы карт OSM требуют Referer — отдаём им только адрес сайта
      maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(m);
    const icon = L.divIcon({ className: 'pin', html: '<span>📍</span>', iconSize: [36, 36], iconAnchor: [18, 34] });
    pin.current = L.marker(start, { draggable: true, icon, keyboard: true, title: '📍' }).addTo(m);
    const set = (p) => change.current(`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`);
    pin.current.on('dragend', () => set(pin.current.getLatLng()));
    m.on('click', (e) => { pin.current.setLatLng(e.latlng); set(e.latlng); });
    map.current = m;
    return () => m.remove();
  }, []);

  // Координаты поменяли снаружи (геопозиция, ввод вручную) — переносим метку
  useEffect(() => {
    const p = parse(value);
    if (!p || !pin.current) return;
    const cur = pin.current.getLatLng();
    if (Math.abs(cur.lat - p[0]) > 1e-6 || Math.abs(cur.lng - p[1]) > 1e-6) {
      pin.current.setLatLng(p);
      map.current.panTo(p);
    }
  }, [value]);

  return <div ref={box} className="map" role="application" aria-label="Map" />;
}
