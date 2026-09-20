const paths = {
  box: "M4 7h16v14H4z M7 7V3h10v4 M4 12h16 M15 16h2",
  library: "M4 4h6v16H4z M14 4h6v16h-6z M4 8h6 M14 8h6",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  clock: "M12 8v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  folder: "M3 6h7l2 3h9v11H3z",
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  plus: "M12 5v14 M5 12h14",
  close: "M6 6l12 12 M6 18 18 6",
  chevron: "m9 5 7 7-7 7",
  down: "m5 9 7 7 7-7",
  arrow: "M5 12h14 m-5-5 5 5-5 5",
  back: "M19 12H5 m5-5-5 5 5 5",
  branch: "M6 3v12a4 4 0 0 0 4 4h2 M6 6h6a6 6 0 0 0 6-6 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M21 3a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  merge: "M6 3v5l6 6v7 M18 3v5l-6 6 M3 6l3-3 3 3 M15 6l3-3 3 3",
  terminal: "m4 5 6 6-6 6 M12 19h8",
  message: "M3 4h18v13H8l-5 4z",
  sliders: "M4 7h9 M17 7h3 M4 17h3 M11 17h9 M13 4v6 M7 14v6",
  copy: "M8 8h12v13H8z M16 8V3H3v13h5",
  check: "m4 12 5 5L20 6",
  download: "M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5",
  shield: "M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6z m-5 10 4 4 6-6",
  refresh: "M20 7V2m0 5h-5 M4 17v5m0-5h5 M4 8a8 8 0 0 1 14-4l2 3 M4 17l2 3a8 8 0 0 0 14-4",
  alert: "m12 3 10 18H2z M12 9v5 M12 17v1",
  edit: "m15 3 6 6-12 12H3v-6z M12 6l6 6",
  activity: "M2 12h5l3-8 4 16 3-8h5",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  keyboard: "M2 5h20v14H2z M5 9h1m3 0h1m3 0h1m3 0h1 M5 13h1m3 0h1m3 0h1m3 0h1 M7 16h10",
  dot: "M13 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0",
  moon: "M20.5 13a8.5 8.5 0 0 1-9.5-9.5A8.5 8.5 0 1 0 20.5 13Z",
  sun: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5",
};

export type IconName = keyof typeof paths;
export function Icon(props: { name: IconName; size?: number; class?: string }) {
  return <svg class={props.class} width={props.size || 18} height={props.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[props.name]} /></svg>;
}
