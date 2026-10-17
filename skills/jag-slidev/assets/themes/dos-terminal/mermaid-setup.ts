// Mermaid config for the dos-terminal theme (day + night). Copy to
// <deck>/setup/mermaid.ts. The palette is picked when each diagram first
// renders, from Slidev's color-scheme class on <html>; toggling the scheme
// live does not re-render existing diagrams (reload the page). Explicitly
// verify the requested scheme in a fresh full export.
// Do NOT import @slidev/types here: it is not a direct dependency, strict
// pnpm cannot resolve it, and the resulting vite error renders on slide 1.
// Node accent classes for fences: tag nodes with `class <id> a|b|aux`.
// Styled here (not via classDef) because mermaid cannot parse var() in
// classDef and hardcoded hexes in fences would break the day/night switch.
const nodeCss = (p: Record<string, { bg: string, stroke: string, ink: string }>) =>
  Object.entries(p).map(([cls, c]) => `
    .node.${cls} rect, .node.${cls} polygon, .node.${cls} circle { fill: ${c.bg} !important; stroke: ${c.stroke} !important; }
    .node.${cls} .nodeLabel, .node.${cls} text { color: ${c.ink} !important; fill: ${c.ink} !important; }
  `).join('\n')

const night = {
  theme: 'base',
  themeCSS: nodeCss({
    a: { bg: '#1c2070', stroke: '#ffd75f', ink: '#ffefb3' },
    b: { bg: '#0e3a78', stroke: '#55ffff', ink: '#ccffff' },
    aux: { bg: '#0d1560', stroke: '#6a74d6', ink: '#d6daff' },
  }),
  themeVariables: {
    darkMode: true,
    background: '#050a51',
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: '15px',

    primaryColor: '#0e3a78',
    primaryTextColor: '#ccffff',
    primaryBorderColor: '#55ffff',
    secondaryColor: '#1c2070',
    tertiaryColor: '#0d1560',
    lineColor: '#7fe9ff',
    textColor: '#d6daff',
    edgeLabelBackground: '#0d1560',

    // Sequence diagrams
    actorBkg: '#0e3a78',
    actorBorder: '#55ffff',
    actorTextColor: '#ccffff',
    actorLineColor: '#6a74d6',
    signalColor: '#7fe9ff',
    signalTextColor: '#d6daff',
    activationBkgColor: '#1c2070',
    activationBorderColor: '#55ffff',
    noteBkgColor: '#1c2070',
    noteTextColor: '#ffefb3',
    labelBoxBkgColor: '#0e3a78',
    labelBoxBorderColor: '#55ffff',
    labelTextColor: '#ccffff',
    loopTextColor: '#d6daff',
  },
}

const day = {
  theme: 'base',
  themeCSS: nodeCss({
    a: { bg: '#f1e7c6', stroke: '#8a6a00', ink: '#3f3000' },
    b: { bg: '#d5ecf1', stroke: '#00697a', ink: '#03323d' },
    aux: { bg: '#e9e8db', stroke: '#98a0c2', ink: '#23306e' },
  }),
  themeVariables: {
    darkMode: false,
    background: '#f0efe6',
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: '15px',

    primaryColor: '#d5ecf1',
    primaryTextColor: '#03323d',
    primaryBorderColor: '#00697a',
    secondaryColor: '#e9e8db',
    tertiaryColor: '#eeede2',
    lineColor: '#3a4a9a',
    textColor: '#23306e',
    edgeLabelBackground: '#f0efe6',

    // Sequence diagrams
    actorBkg: '#d5ecf1',
    actorBorder: '#00697a',
    actorTextColor: '#03323d',
    actorLineColor: '#98a0c2',
    signalColor: '#3a4a9a',
    signalTextColor: '#23306e',
    activationBkgColor: '#e9e8db',
    activationBorderColor: '#00697a',
    noteBkgColor: '#f1e7c6',
    noteTextColor: '#3f3000',
    labelBoxBkgColor: '#d5ecf1',
    labelBoxBorderColor: '#00697a',
    labelTextColor: '#03323d',
    loopTextColor: '#23306e',
  },
}

export default () => {
  const dark = typeof document !== 'undefined'
    && document.documentElement.classList.contains('dark')
  return dark ? night : day
}
