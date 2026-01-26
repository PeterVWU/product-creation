# Magento Product Description Generation Design

## Overview

Add an endpoint to generate AI-powered product descriptions for Magento products. The endpoint accepts a SKU, fetches the product and its variant flavors from the target Magento store, uses OpenAI GPT-4o to generate an SEO-optimized HTML description, and updates the product.

## Endpoint

**Route:** `POST /api/v1/products/generate-description`

**Request Body:**
```json
{
  "sku": "NEXA-ULTRA-V2"
}
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "sku": "NEXA-ULTRA-V2",
    "title": "Nexa Ultra V2 50K Puffs Disposable Vape",
    "flavorsFound": 15,
    "description": "<div>...</div>",
    "updatedAt": "2026-01-26T..."
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": {
    "code": "PRODUCT_NOT_FOUND",
    "message": "Product with SKU 'XYZ' not found"
  }
}
```

## Architecture

### New Files

```
src/routes/v1/product.routes.js        # New route file
src/controllers/product.controller.js  # Controller for product operations
src/services/ai/openai.client.js       # OpenAI API client
src/services/description.service.js    # Description generation logic
```

### Flow

```
Request → Controller → DescriptionService → TargetService (get product)
                                          → OpenAI Client (generate)
                                          → TargetService (update product)
```

### DescriptionService Responsibilities

1. Call `targetService.getProductBySku(sku)` to fetch the configurable product
2. Call `targetService.getConfigurableChildren(sku)` to get child variants
3. Extract `name` (title) and `flavor` attributes from children
4. Build the prompt with title and flavors list
5. Call `openaiClient.generateDescription(prompt)`
6. Call `targetService.updateProduct(sku, { description })` to save
7. Return result

## OpenAI Integration

### Client (`src/services/ai/openai.client.js`)

- Uses the `openai` npm package (official SDK)
- Model: `gpt-4o` (fast, cost-effective, good at creative content)
- Simple wrapper with retry logic matching existing patterns

### Configuration

New environment variables:
```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o          # optional, defaults to gpt-4o
```

### Client Structure

```javascript
class OpenAIClient {
  constructor() {
    this.client = new OpenAI({ apiKey: config.openai.apiKey });
    this.model = config.openai.model || 'gpt-4o';
  }

  async generateDescription(prompt) {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,  // Some creativity for vivid descriptions
    });
    return response.choices[0].message.content;
  }
}
```

## Prompt Template

```
Write a 5 sentence description for {title}. This is a web listing that should be seo-optimized. Voice should be informative and professional, emphasizing key product features.

Reference the flavor list below for a concise flavor description for each of the following using vivid and highly sensuous language in a simple bulleted list format. Bold the flavor names. Reference example format attached. Also include a features section based on your findings.

Include 15 SEO keywords relevant to this product at the end.

FLAVORS:
{flavors}

Example:
<div>Nexa Ultra V2 50K Puffs Disposable Vape</div>
<div>
    <p>"Experience next-level vaping with the Nexa Ultra V2 50K Puffs Disposable Vape Device...</p>
    <p><strong>Flavors:</strong></p>
    <ul>
        <li><strong>Watermelon Ice:</strong> A lush burst of sun-ripened watermelon...</li>
    </ul>
    <p><strong>Features:</strong></p>
    <ul>
        <li>Up to 50,000 Puffs</li>
    </ul>
</div>
```

If no flavors are found, the flavor section is omitted from the prompt and the generated description will focus on the product title and features only.

## Error Handling

### Custom Error Class

```javascript
class DescriptionGenerationError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'DescriptionGenerationError';
    this.code = code;
    this.details = details;
  }
}
```

### Error Scenarios

| Scenario | Code | HTTP Status |
|----------|------|-------------|
| Product not found by SKU | `PRODUCT_NOT_FOUND` | 404 |
| Product is not configurable (no children) | `NOT_CONFIGURABLE` | 400 |
| OpenAI API failure | `AI_GENERATION_FAILED` | 502 |
| OpenAI rate limit | `AI_RATE_LIMITED` | 429 |
| Magento update fails | `UPDATE_FAILED` | 502 |

### Retry Logic

- OpenAI calls: 3 retries with exponential backoff
- Magento calls: Already handled by existing `TargetService`

## Files Modified

- `src/app.js` - Register new route
- `src/config/index.js` - Add OpenAI config
- `src/utils/error-handler.js` - Add new error class

## Dependencies

New npm package:
- `openai` - Official OpenAI SDK
