# Per-Store AI Content Generation During Migration

## Problem

When migrating products to multiple target stores, each store may need customized titles and descriptions tailored to its audience. Currently, all stores receive the same source title and description verbatim. Store operators must manually rewrite content per store after migration.

## Solution

Add an AI content generation phase to the migration flow that runs after extraction but before any product creation. For each target store that includes a prompt in the request, call OpenAI to generate a customized title and description. Stores without prompts receive the original source content unchanged.

## API Request Shape

The migration request gains an optional `storePrompts` field:

```json
{
  "sku": "PARENT-SKU",
  "options": {
    "targetMagentoStores": ["ejuices", "misthub"],
    "storePrompts": {
      "ejuices": {
        "prompt": "Write for a premium vape audience. Emphasize flavor variety and device specs."
      }
    }
  }
}
```

- Only stores present in `storePrompts` get AI-generated content.
- Stores absent from `storePrompts` use the original source title and description.

## AI Content Generation Phase

Runs after extraction, before the per-store creation loop.

### Input
- `extractedData` — contains `parent.name` and description from `custom_attributes`
- `storePrompts` — from the request

### Process
For each store in `storePrompts`, call OpenAI with a prompt combining:
- The user's custom prompt text
- The original product title
- The original product description

Prompt template sent to OpenAI:

```
{userPrompt}

Based on the following product information, generate a customized title and description.

Original Title: {originalTitle}
Original Description: {originalDescription}

Return your response as a JSON object with two fields:
1. "title": The customized product title
2. "description": The customized product description in HTML format

Respond ONLY with the JSON object, no other text.
```

### Output
A `generatedContent` map:
```json
{
  "ejuices": {
    "title": "Custom Title for eJuices",
    "description": "<div>Custom HTML description...</div>"
  }
}
```

### Error Handling
If any AI call fails after retries, the entire migration aborts. Since this phase runs before any product creation, no cleanup is needed.

## Data Flow Through Creation

During the per-store migration loop in the orchestrator:

1. **Store has AI content:** Clone `extractedData`, override `parent.name` with the AI title, override the `description` custom attribute with the AI description. Pass the modified clone to `migrateToInstance` or `migrateStandaloneToInstance`.

2. **Store has no AI content:** Pass the original `extractedData` unchanged.

For configurable products, AI content applies to the parent only — children keep their original names (they are variants like "Product - Apple").

For standalone simple products, AI content applies directly to the product.

## Implementation Scope

### New file
- `src/services/ai/content-generation.service.js` — takes `extractedData` + `storePrompts`, calls OpenAI for each store, returns `generatedContent` map. Reuses the existing `OpenAIClient`.

### Modified files
- `src/services/migration/orchestrator.service.js` — adds AI content generation phase after extraction; applies generated content per-store before calling `migrateToInstance`/`migrateStandaloneToInstance`.
- `src/middleware/validation.middleware.js` — validates the optional `storePrompts` field in migration requests.

### Unchanged
- `CreationService`, `StandaloneMagentoCreationService` — no changes; they receive different input data.
- `OpenAIClient` — reused as-is.
- `DescriptionService` — existing standalone endpoint, untouched.
- Shopify flow — not affected.
