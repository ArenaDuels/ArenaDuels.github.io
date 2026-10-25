// Inline SVG icons (stroke icons use currentColor so CSS can colour them).
// Used instead of emoji, which look different on every device.

const stroke = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const solid = (inner) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${inner}</svg>`;

export const ICONS = {
  // ---- accessories ----
  none: stroke('<circle cx="12" cy="12" r="8"/><path d="M6.4 6.4l11.2 11.2"/>'),
  tophat: stroke('<path d="M3.5 18h17"/><path d="M7 18V6.5h10V18"/><path d="M7 13.5h10"/>'),
  crown: stroke('<path d="M4 18.5h16"/><path d="M4.5 17L3.5 7.5l5 4 3.5-6 3.5 6 5-4-1 9.5z"/>'),
  halo: stroke('<ellipse cx="12" cy="6" rx="6.5" ry="2.4"/><circle cx="12" cy="15" r="4.2"/><path d="M5 21c1.5-2.2 4-3 7-3s5.5.8 7 3"/>'),
  horns: stroke('<path d="M6.5 19c-3-3-3-9.5 0-14 0 5 2 8.5 5.5 10"/><path d="M17.5 19c3-3 3-9.5 0-14 0 5-2 8.5-5.5 10"/>'),
  antenna: stroke('<path d="M12 20V9"/><circle cx="12" cy="6" r="2.2"/><path d="M7.5 20h9"/><path d="M7 4.5a7 7 0 0 0 0 7M17 4.5a7 7 0 0 1 0 7"/>'),
  shades: stroke('<path d="M2.5 10h19"/><rect x="3.5" y="10" width="7.5" height="5.5" rx="2.2"/><rect x="13" y="10" width="7.5" height="5.5" rx="2.2"/>'),
  party: stroke('<path d="M12 5l7 14.5H5z"/><path d="M8.2 14h7.6"/><circle cx="12" cy="3.6" r="1.3"/>'),

  // ---- body patterns (filled swatches) ----
  solid: solid('<rect x="4" y="4" width="16" height="16" rx="4"/>'),
  stripes: solid('<rect x="4" y="4" width="3.2" height="16" rx="1"/><rect x="10.4" y="4" width="3.2" height="16" rx="1"/><rect x="16.8" y="4" width="3.2" height="16" rx="1"/>'),
  bands: solid('<rect x="4" y="4" width="16" height="3.2" rx="1"/><rect x="4" y="10.4" width="16" height="3.2" rx="1"/><rect x="4" y="16.8" width="16" height="3.2" rx="1"/>'),
  dots: solid('<circle cx="7" cy="7" r="2.1"/><circle cx="17" cy="7" r="2.1"/><circle cx="12" cy="12" r="2.1"/><circle cx="7" cy="17" r="2.1"/><circle cx="17" cy="17" r="2.1"/>'),
  checker: solid('<rect x="4" y="4" width="8" height="8"/><rect x="12" y="12" width="8" height="8"/><rect x="12" y="4" width="8" height="8" opacity="0.28"/><rect x="4" y="12" width="8" height="8" opacity="0.28"/>'),

  // ---- interface ----
  dice: stroke('<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor"/>'),
  gear: stroke('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/><circle cx="12" cy="12" r="6.6"/>'),
  lock: stroke('<rect x="5" y="11" width="14" height="9.5" rx="2.2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  globe: stroke('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3.2 3.2 3.2 14.8 0 18M12 3c-3.2 3.2-3.2 14.8 0 18"/>'),
  trophy: stroke('<path d="M8 4h8v6a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4.2M16 6h3a3 3 0 0 1-3 4.2"/><path d="M12 14.2V18M8.5 20.5h7"/>'),
  target: stroke('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>'),
};

export const iconSvg = (name) => ICONS[name] ?? "";
