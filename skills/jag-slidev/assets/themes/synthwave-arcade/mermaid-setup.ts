// Mermaid config for the synthwave-arcade theme (day + night). Copy to
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
    a: { bg: '#380f33', stroke: '#ff3ec8', ink: '#ffd6f1' },
    b: { bg: '#0a2c3d', stroke: '#29f0ff', ink: '#d2fbff' },
    aux: { bg: '#1c0f2e', stroke: '#6a4a9a', ink: '#d9c8ff' },
  }),
  themeVariables: {
    darkMode: true,
    background: '#10031d',
    fontFamily: '"Space Mono", monospace',
    fontSize: '15px',

    primaryColor: '#0a2c3d',
    primaryTextColor: '#d2fbff',
    primaryBorderColor: '#29f0ff',
    secondaryColor: '#380f33',
    tertiaryColor: '#1c0f2e',
    lineColor: '#6ee7f5',
    textColor: '#d9c8ff',
    edgeLabelBackground: '#1c0f2e',

    // Sequence diagrams
    actorBkg: '#0a2c3d',
    actorBorder: '#29f0ff',
    actorTextColor: '#d2fbff',
    actorLineColor: '#6a4a9a',
    signalColor: '#6ee7f5',
    signalTextColor: '#d9c8ff',
    activationBkgColor: '#380f33',
    activationBorderColor: '#ff3ec8',
    noteBkgColor: '#380f33',
    noteTextColor: '#ffd6f1',
    labelBoxBkgColor: '#0a2c3d',
    labelBoxBorderColor: '#29f0ff',
    labelTextColor: '#d2fbff',
    loopTextColor: '#d9c8ff',
  },
}

const day = {
  theme: 'base',
  themeCSS: nodeCss({
    a: { bg: '#fadced', stroke: '#cf1183', ink: '#6e0243' },
    b: { bg: '#d5edf4', stroke: '#0d7f9e', ink: '#043a4a' },
    aux: { bg: '#efe7f4', stroke: '#a58cc0', ink: '#46236e' },
  }),
  themeVariables: {
    darkMode: false,
    background: '#fbf1ef',
    fontFamily: '"Space Mono", monospace',
    fontSize: '15px',

    primaryColor: '#d5edf4',
    primaryTextColor: '#043a4a',
    primaryBorderColor: '#0d7f9e',
    secondaryColor: '#fadced',
    tertiaryColor: '#efe7f4',
    lineColor: '#8a4aa8',
    textColor: '#46236e',
    edgeLabelBackground: '#fbf1ef',

    // Sequence diagrams
    actorBkg: '#d5edf4',
    actorBorder: '#0d7f9e',
    actorTextColor: '#043a4a',
    actorLineColor: '#a58cc0',
    signalColor: '#8a4aa8',
    signalTextColor: '#46236e',
    activationBkgColor: '#fadced',
    activationBorderColor: '#cf1183',
    noteBkgColor: '#fadced',
    noteTextColor: '#6e0243',
    labelBoxBkgColor: '#d5edf4',
    labelBoxBorderColor: '#0d7f9e',
    labelTextColor: '#043a4a',
    loopTextColor: '#46236e',
  },
}

export default () => {
  const dark = typeof document !== 'undefined'
    && document.documentElement.classList.contains('dark')
  return dark ? night : day
}
