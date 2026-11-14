import type { EventIcon } from '../data/adapters';

const paths: Record<EventIcon, React.ReactNode> = {
  wicket: <><path d="M7 4v16M12 4v16M17 4v16M5 4h14"/><path d="M4 20h16"/></>,
  six: <><circle cx="12" cy="12" r="8"/><path d="M9 15l6-6"/></>,
  four: <><rect x="5" y="5" width="14" height="14"/><path d="M8 12h8"/></>,
  ball: <><circle cx="12" cy="12" r="8"/><path d="m8 8 8 8m0-8-8 8"/></>,
  over: <><path d="M5 6h14M5 12h14M5 18h14"/><path d="M8 4v4m8-4v4"/></>,
  goal: <><path d="M4 5h16v14H4z"/><path d="M8 9h8v6H8z"/></>,
  saved: <><path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z"/><path d="m9 12 2 2 4-4"/></>,
  card: <><rect x="6" y="3" width="12" height="18" rx="1"/><path d="M9 7h6"/></>,
  substitution: <><path d="M4 7h14l-3-3m5 13H6l3 3"/></>,
  penalty: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></>,
  var: <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
  'safety-car': <><path d="M3 15h18l-2-5H7l-4 5zM5 15v3h2m10 0h2v-3M8 10l2-4h5l3 4"/><circle cx="8" cy="15" r="1"/><circle cx="16" cy="15" r="1"/></>,
  flag: <><path d="M5 21V4m0 1h13l-3 4 3 4H5"/></>,
  pit: <><path d="M4 8h16M7 4v8m10-8v8M5 12h14l-2 8H7z"/></>,
  position: <><path d="M7 19V5m0 0L4 8m3-3 3 3M17 5v14m0 0 3-3m-3 3-3-3"/></>,
  'fastest-lap': <><circle cx="12" cy="13" r="8"/><path d="M12 13l4-3M9 2h6m-3 3V3"/></>,
  retirement: <><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></>,
};

export function EventGlyph({ icon, size = 16 }: { icon: EventIcon; size?: number }) {
  return <svg className="event-glyph" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[icon]}</svg>;
}
