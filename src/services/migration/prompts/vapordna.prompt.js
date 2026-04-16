const WITH_FLAVORS = `Write a VaporDNA product listing for {title}. Output SEO-optimized HTML in the exact structure shown in the example below. Voice is informative and professional; flavor descriptions are concise, evocative, and culinary.

REQUIRED LINKS (must all appear, each as its own <a> tag with target="_blank" and a descriptive title attribute). Embed them INLINE inside the opening paragraph, woven naturally into the prose — do NOT place them in a trailing "Explore More" list:
- Brand collection page: {brandCollectionUrl}
- VaporDNA homepage: {homepageUrl}
- Disposable vapes collection: {disposablesUrl}

FLAVORS:
{flavors}

{partnerBlock}

Structure requirements:
1. <h2><strong>{title}</strong></h2>
2. A single <p> (2-3 sentences) that introduces the product and contains all three required links, each with descriptive anchor text (e.g. "Geek Bar lineup", "VaporDNA", "disposable vaping"), target="_blank", and a meaningful title attribute.
3. <h2>Flavors</h2> followed by a <ul>. Each flavor is one <li> containing <strong>Flavor Name</strong> — one concise evocative sentence describing the taste.
4. <h2>Product Specs</h2> followed by a <ul>. Each spec is one <li> containing <strong>Spec Name:</strong> value. Include specs you can reasonably infer (e.g. Brand, Model, Puff Count, Nicotine Type, Nicotine Strength, Battery, Draw Activated).

Return your response as a JSON object with two fields:
1. "description": The HTML content (follow the example format precisely)
2. "keywords": A comma-separated string of 15 SEO keywords relevant to this product

Example HTML (follow this structure exactly):
<h2><strong>Geek USA Pulse D 40K Puffs Disposable Vape</strong></h2><p>The <a href="https://vapordna.com/collections/disposable-vapes" target="_blank" title="Disposable Vapes at VaporDNA">Geek USA Pulse D</a> pushes the limits of disposable vaping with an enormous 40,000 puff count, a rechargeable battery, and a lineup of bold, carefully crafted flavors. Built for vapers who want maximum longevity and premium flavor in a compact, draw-activated device, the Pulse D is your next all-day-vape. Available in 16 flavors at <a href="https://vapordna.com" target="_blank" title="VaporDNA - Premium Vape Shop">VaporDNA</a> — explore the full <a href="https://vapordna.com/collections/geek-bar" target="_blank" title="Geek Bar collection at VaporDNA">Geek Bar lineup</a> while you're at it.</p><h2>Flavors</h2><ul>
<li><strong>Banana Toffee</strong> — Creamy, ripe banana layered over rich, buttery toffee sweetness.</li>
<li><strong>Watermelon Ice</strong> — Fresh, juicy watermelon with an icy cool menthol exhale.</li>
</ul><h2>Product Specs</h2><ul>
<li><strong>Brand:</strong> Geek USA</li>
<li><strong>Model:</strong> Pulse D</li>
<li><strong>Puff Count:</strong> 40,000</li>
<li><strong>Nicotine Type:</strong> Nicotine Salt</li>
<li><strong>Nicotine Strength:</strong> 5%</li>
<li><strong>Battery:</strong> Rechargeable (USB-C)</li>
<li><strong>Draw Activated:</strong> Yes</li>
</ul>

Respond ONLY with the JSON object, no other text.`;

const NO_FLAVORS = `Write a VaporDNA product listing for {title}. Output SEO-optimized HTML in the exact structure shown below. Voice is informative and professional.

REQUIRED LINKS (must all appear, each as its own <a> tag with target="_blank" and a descriptive title attribute). Embed them INLINE inside the opening paragraph, woven naturally into the prose — do NOT place them in a trailing "Explore More" list:
- Brand collection page: {brandCollectionUrl}
- VaporDNA homepage: {homepageUrl}
- Disposable vapes collection: {disposablesUrl}

{partnerBlock}

Structure requirements:
1. <h2><strong>{title}</strong></h2>
2. A single <p> (2-3 sentences) that introduces the product and contains all three required links, each with descriptive anchor text, target="_blank", and a meaningful title attribute.
3. <h2>Product Specs</h2> followed by a <ul>. Each spec is one <li> containing <strong>Spec Name:</strong> value. Include specs you can reasonably infer (e.g. Brand, Model, key performance metrics, materials, power/battery, included accessories).

Return your response as a JSON object with two fields:
1. "description": The HTML content (follow the example format precisely)
2. "keywords": A comma-separated string of 15 SEO keywords relevant to this product

Example HTML (follow this structure exactly):
<h2><strong>Example Product Name</strong></h2><p>The <a href="https://vapordna.com/collections/disposable-vapes" target="_blank" title="Disposable Vapes at VaporDNA">Example Product</a> delivers exceptional performance with a premium build and refined styling. Designed for vapers who value reliability, it pairs thoughtful engineering with proven flavor performance, available exclusively at <a href="https://vapordna.com" target="_blank" title="VaporDNA - Premium Vape Shop">VaporDNA</a> alongside the full <a href="https://vapordna.com/collections/brand-slug" target="_blank" title="Brand collection at VaporDNA">brand collection</a>.</p><h2>Product Specs</h2><ul>
<li><strong>Brand:</strong> Example Brand</li>
<li><strong>Battery:</strong> Rechargeable (USB-C)</li>
<li><strong>Material:</strong> Aluminum alloy</li>
</ul>

Respond ONLY with the JSON object, no other text.`;

const PARTNER_INSTRUCTION = `COMPANION LISTING: This product has a paired kit/pod on VaporDNA. Add ONE more short paragraph (<p>) immediately after the Product Specs section that naturally references and links to the companion listing, using an <a> tag with target="_blank" and a descriptive title attribute pointing to: {partnerUrl}`;

function buildPartnerBlock(partnerUrl) {
  if (!partnerUrl) return '';
  return PARTNER_INSTRUCTION.replace('{partnerUrl}', partnerUrl);
}

function buildPrompt({ title, flavors = [], brandCollectionUrl, homepageUrl, disposablesUrl, partnerUrl = null }) {
  const template = flavors.length > 0 ? WITH_FLAVORS : NO_FLAVORS;
  const flavorsList = flavors.map(f => `- ${f}`).join('\n');
  const partnerBlock = buildPartnerBlock(partnerUrl);

  return template
    .replace(/{title}/g, title)
    .replace('{flavors}', flavorsList)
    .replace(/{brandCollectionUrl}/g, brandCollectionUrl)
    .replace(/{homepageUrl}/g, homepageUrl)
    .replace(/{disposablesUrl}/g, disposablesUrl)
    .replace('{partnerBlock}', partnerBlock);
}

module.exports = {
  buildPrompt,
  WITH_FLAVORS,
  NO_FLAVORS
};
