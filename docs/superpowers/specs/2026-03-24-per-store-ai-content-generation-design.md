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
- The nested object shape (`{ "prompt": "..." }`) allows future extensibility (e.g., `tone`, `language`).

### Validation Rules

Added to the migration route definition (not the generic validation middleware):

- `storePrompts` is optional. If present, must be a plain object.
- Each key must be a string matching a store name in `targetMagentoStores`. Keys naming stores not in `targetMagentoStores` are a validation error.
- Each value must be an object with a `prompt` field that is a non-empty string.

## AI Content Generation Phase

Runs after extraction, before the per-store creation loop. Tracked as `phases.aiGeneration` in the migration context (with `success`, `duration`, and `storesGenerated` count).

### Input
- `extractedData.parent.name` — the original product title
- `extractedData.parent.custom_attributes` array — find element where `attribute_code === 'description'` and read its `value` for the original description
- `storePrompts` — from the request

### Process
For each store in `storePrompts`, call OpenAI using the existing `OpenAIClient.generateDescription()` method (reuses model, temperature, and retry settings from config). Calls run sequentially to respect rate limits.

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

### Response Parsing

`OpenAIClient.generateDescription()` returns a raw string. The new service parses it as JSON to extract `{ title, description }`. If JSON parsing fails, attempt to extract a JSON object from the response (same fallback pattern as `DescriptionService.parseAIResponse`). If parsing still fails, treat it as a generation failure (abort migration).

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
If any AI call fails after retries, or any response fails to parse, the entire migration aborts. Since this phase runs before any product creation, no cleanup is needed.

## Data Flow Through Creation

During the per-store migration loop in the orchestrator:

1. **Store has AI content** (e.g., `ejuices`): Create a modified copy of `extractedData` with overridden parent content. Specifically:
   - Deep clone `parent` (including the `custom_attributes` array) to avoid mutating the shared source object.
   - Set `clonedParent.name` to the AI-generated title.
   - Find the `description` entry in `clonedParent.custom_attributes` and replace its `value` with the AI-generated description. If no `description` entry exists, add one.
   - Spread the rest of `extractedData` (children, translations, images, etc.) by reference — only `parent` needs cloning.
   - Pass the modified object to `migrateToInstance` or `migrateStandaloneToInstance`.

2. **Store has no AI content** (e.g., `misthub`): Pass the original `extractedData` unchanged.

For configurable products, AI content applies to the parent only — children keep their original names (they are variants like "Product - Apple").

For standalone simple products, AI content applies directly to the product.

## Migration Response

The migration response includes AI generation details:

- `phases.aiGeneration` — `{ success, duration, storesGenerated }` (mirrors the pattern of `phases.extraction`)
- Each store's result in `instanceResults` includes `aiContentApplied: true/false` to indicate whether AI content was used

## Batch Migration

`storePrompts` applies to batch migrations (`migrateProductsBatch`). The same prompts are used for every SKU in the batch — OpenAI is called per-store per-SKU. This is the expected behavior since batch migration shares a single `options` object.

## Implementation Scope

### New file
- `src/services/ai/content-generation.service.js` — takes `extractedData` + `storePrompts`, calls OpenAI for each store, returns `generatedContent` map. Reuses the existing `OpenAIClient`. Includes JSON response parsing with the same fallback pattern as `DescriptionService`.

### Modified files
- `src/services/migration/orchestrator.service.js` — adds AI content generation phase after extraction; applies generated content per-store before calling `migrateToInstance`/`migrateStandaloneToInstance`. Adds `phases.aiGeneration` to migration context.
- `src/routes/v1/migration.routes.js` — adds validation rules for the optional `storePrompts` field (structure, prompt non-empty, keys match `targetMagentoStores`).

### Unchanged
- `CreationService`, `StandaloneMagentoCreationService` — no changes; they receive different input data.
- `OpenAIClient` — reused as-is.
- `DescriptionService` — existing standalone endpoint, untouched.
- Shopify flow — not affected.
