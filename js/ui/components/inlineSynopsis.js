// Fit the text and its inline control together. The button participates in
// normal line layout, so it follows the last visible words without covering
// them or reserving a column beside both lines.
export function fitInlineSynopsis(paragraph, text, toggle, source, expanded = false) {
  const fullText = String(source || "");
  text.textContent = fullText;
  paragraph.style.maxHeight = "none";
  toggle.hidden = !expanded;
  if (expanded) return;

  const style = getComputedStyle(paragraph);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
  const limit = lineHeight * 2;
  paragraph.style.maxHeight = `${limit}px`;
  const fits = () =>
    paragraph.scrollHeight <= limit + 1 && paragraph.scrollWidth <= paragraph.clientWidth + 1;
  if (fits()) {
    paragraph.classList.remove("is-truncated");
    return;
  }

  toggle.hidden = false;
  const characters = Array.from(fullText);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    text.textContent = `${characters.slice(0, mid).join("").trimEnd()}...`;
    if (fits()) low = mid;
    else high = mid - 1;
  }
  text.textContent = `${characters.slice(0, low).join("").trimEnd()}...`;
  paragraph.classList.add("is-truncated");
}
