const META_DESCRIPTION_MAX = 160;

function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function buildMetaTitle(title, price) {
  const priceNum = Number(price);
  const priceStr = Number.isFinite(priceNum) ? priceNum.toFixed(2) : String(price);
  return `"${title}" | Only $${priceStr}`;
}

function buildMetaDescription(descriptionHtml) {
  const text = stripHtml(descriptionHtml);
  if (text.length <= META_DESCRIPTION_MAX) return text;
  const cut = text.slice(0, META_DESCRIPTION_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > META_DESCRIPTION_MAX - 20) {
    return cut.slice(0, lastSpace);
  }
  return cut;
}

function sortVariantsAlphabetically(variants) {
  const keyOf = v => (v.optionValues || [])
    .map(ov => String(ov.name || '').toLowerCase())
    .join('|');
  return [...variants].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

function detectKitOrPod(title) {
  if (!title) return null;
  const t = String(title).toLowerCase();
  const hasKit = /\bkit\b/.test(t);
  const hasPod = /\b(pod|refill|cartridge)\b/.test(t);
  if (hasKit && !hasPod) return 'kit';
  if (hasPod && !hasKit) return 'pod';
  return null;
}

function derivePartnerSearchTitle(title, kind) {
  if (!title || !kind) return null;
  if (kind === 'kit') {
    return title.replace(/\bkit\b/gi, '').replace(/\s+/g, ' ').trim();
  }
  return title.replace(/\b(refill pod|refill|pod|cartridge)\b/gi, '').replace(/\s+/g, ' ').trim();
}

module.exports = {
  META_DESCRIPTION_MAX,
  stripHtml,
  buildMetaTitle,
  buildMetaDescription,
  sortVariantsAlphabetically,
  detectKitOrPod,
  derivePartnerSearchTitle
};
