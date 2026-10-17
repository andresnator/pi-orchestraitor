// Mermaid config for the crt-phosphor theme (day + night). Copy to
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
    a: { bg: '#151006', stroke: '#ffb000', ink: '#ffe9bf' },
    b: { bg: '#0d1a10', stroke: '#33ff66', ink: '#d9ffe4' },
    aux: { bg: '#0a120c', stroke: '#3f5a46', ink: '#a9f5b9' },
  }),
  themeVariables: {
    darkMode: true,
    background: '#040704',
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: '15px',

    primaryColor: '#0d1a10',
    primaryTextColor: '#d9ffe4',
    primaryBorderColor: '#33ff66',
    secondaryColor: '#101d14',
    tertiaryColor: '#0a120c',
    lineColor: '#5aff8c',
    textColor: '#a9f5b9',
    edgeLabelBackground: '#0a120c',

    // Sequence diagrams
    actorBkg: '#0d1a10',
    actorBorder: '#33ff66',
    actorTextColor: '#d9ffe4',
    actorLineColor: '#3f5a46',
    signalColor: '#5aff8c',
    signalTextColor: '#a9f5b9',
    activationBkgColor: '#101d14',
    activationBorderColor: '#33ff66',
    noteBkgColor: '#151006',
    noteTextColor: '#ffe9bf',
    labelBoxBkgColor: '#0d1a10',
    labelBoxBorderColor: '#33ff66',
    labelTextColor: '#d9ffe4',
    loopTextColor: '#a9f5b9',
  },
}

const day = {
  theme: 'base',
  themeCSS: nodeCss({
    a: { bg: '#f2e6cd', stroke: '#a06000', ink: '#4a2d00' },
    b: { bg: '#dcedde', stroke: '#0e7a35', ink: '#093a1a' },
    aux: { bg: '#ecf1ea', stroke: '#86a08e', ink: '#1c3a24' },
  }),
  themeVariables: {
    darkMode: false,
    background: '#eef4ec',
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: '15px',

    primaryColor: '#dcedde',
    primaryTextColor: '#093a1a',
    primaryBorderColor: '#0e7a35',
    secondaryColor: '#e6efe3',
    tertiaryColor: '#ecf1ea',
    lineColor: '#2e6b44',
    textColor: '#1c3a24',
    edgeLabelBackground: '#eef4ec',

    // Sequence diagrams
    actorBkg: '#dcedde',
    actorBorder: '#0e7a35',
    actorTextColor: '#093a1a',
    actorLineColor: '#86a08e',
    signalColor: '#2e6b44',
    signalTextColor: '#1c3a24',
    activationBkgColor: '#e6efe3',
    activationBorderColor: '#0e7a35',
    noteBkgColor: '#f2e6cd',
    noteTextColor: '#4a2d00',
    labelBoxBkgColor: '#dcedde',
    labelBoxBorderColor: '#0e7a35',
    labelTextColor: '#093a1a',
    loopTextColor: '#1c3a24',
  },
}

export default () => {
  const dark = typeof document !== 'undefined'
    && document.documentElement.classList.contains('dark')
  return dark ? night : day
}
