// One chevron for every round Back control. Settings' section Back already
// draws this stroked path; the other pages used the Material glyph, which sits
// at a different weight and optical size inside the same circle.
export function renderBackButtonIcon(className = "round-back-icon") {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15 6-6 6 6 6"></path></svg>`;
}
