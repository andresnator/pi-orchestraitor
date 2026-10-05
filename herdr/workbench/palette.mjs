// Explicit presets, not automatic Herdr theme inheritance. Nord values retain:
// MIT License (MIT)
// Copyright (c) 2016-present Sven Greb <development@svengreb.de> (https://www.svengreb.de)
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
export const PALETTES = {
	nord: { background: "#2e3440", text: "#eceff4", muted: "#b7c0ce", focus: "#40505d", accent: "#88c0d0", active: "#ebcb8b", blocked: "#bf616a", done: "#8fbcbb", idle: "#a3be8c" },
	light: { background: "#ffffff", text: "#202939", muted: "#526071", focus: "#dcebf4", accent: "#005b78", active: "#795100", blocked: "#a12636", done: "#006963", idle: "#346520" },
	mono: {},
};
export function selectPalette(name = "nord", env = process.env) {
	if (!Object.hasOwn(PALETTES, name)) throw new Error("Unknown workbench palette; choose nord, light or mono");
	if (Object.hasOwn(env, "NO_COLOR") || env.TERM === "dumb") name = "mono";
	return { name, mode: /truecolor|24bit/.test(env.COLORTERM ?? "") ? "truecolor" : "256color" };
}
export function createPaint(ui, name, mode) {
	const colors = Object.fromEntries(Object.entries(PALETTES[name]).map(([key, value]) => [key, ui.parseColor(value)]));
	return (text, role = "text", focused = false, bold = false) => name === "mono" ? text : ui.styleText(text,
		{ fg: colors[role] ?? colors.text, bg: focused ? colors.focus : colors.background, bold }, mode);
}
