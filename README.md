# Magento Product Migration API

A Node.js REST API server for migrating products from a source Magento instance to target platforms (Magento or Shopify).

## Features

- Migrate configurable products with all their simple product children
- **Standalone simple product migration** - migrate standalone simple products (non-configurable, catalog-visible) to Magento and Shopify
- Automatic attribute and attribute value mapping
- Image migration with optimization
- Comprehensive error handling and logging
- Continue-on-error pattern (doesn't stop on non-critical errors)
- Support for batch migrations
- **Multi-instance Magento support** - migrate products to multiple independent Magento instances in a single operation
- **Shopify migration support** - migrate Magento products to Shopify stores using GraphQL Admin API
- Health check endpoints
- Real-time Google Chat notifications for migration and price sync status
- **Price synchronization** - sync regular and special prices from source to target Magento stores and Shopify; supports both configurable and standalone simple products
- **Product fields update** - push content fields (name, brand, categories, images, description, SEO) from source Magento to target Magento stores and Shopify in one call; supports both configurable and standalone simple products
- **AI-powered product descriptions** - generate SEO-optimized descriptions using OpenAI GPT-4o
- **Per-store AI content generation** - generate customized product titles and descriptions for each target store during migration using OpenAI, with per-store prompts tailored to different audiences

## Prerequisites

- Node.js 18+
- npm or yarn
- Access to both source and target Magento instances
- Magento admin API tokens for both instances

## Installation

1. Clone the repository or navigate to the project directory:
```bash
cd product-creation
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

4. Edit `.env` file with your Magento credentials:
```env
SOURCE_MAGENTO_BASE_URL=https://staging.vapewholesaleusa.com
SOURCE_MAGENTO_TOKEN=your_source_token

MAGENTO_STORE_EJUICES_URL=https://www.ejuices.com/
MAGENTO_STORE_EJUICES_TOKEN=your_ejuices_token

MAGENTO_STORE_MISTHUB_URL=https://misthub.example.com/
MAGENTO_STORE_MISTHUB_TOKEN=your_misthub_token
```

## Docker Setup

### Prerequisites

- Docker Engine 20.10+
- Docker Compose v2+

### Quick Start

1. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your Magento credentials
```

2. Create the logs directory with proper permissions:
```bash
mkdir -p logs && chmod 777 logs
```

3. Build and start the container:
```bash
docker-compose up -d
```

4. Verify the container is running:
```bash
docker-compose ps
```

5. Check the health endpoint:
```bash
curl http://localhost:3000/api/v1/health
```

### Docker Commands

**Build the image:**
```bash
docker-compose build
```

**Build without cache (after code changes):**
```bash
docker-compose build --no-cache
```

**Start the container:**
```bash
docker-compose up -d
```

**View logs:**
```bash
docker-compose logs -f
```

**Stop the container:**
```bash
docker-compose down
```

**Restart the container:**
```bash
docker-compose restart
```

### Configuration

The container reads environment variables from the `.env` file. You can also override them directly in `docker-compose.yml`.

Key environment variables:
- `SOURCE_MAGENTO_BASE_URL` - Source Magento instance URL
- `SOURCE_MAGENTO_TOKEN` - Source Magento API token
- `MAGENTO_STORE_<NAME>_URL` - Target Magento instance URL (one per instance, e.g., `MAGENTO_STORE_EJUICES_URL`)
- `MAGENTO_STORE_<NAME>_TOKEN` - Target Magento instance API token (one per instance, e.g., `MAGENTO_STORE_EJUICES_TOKEN`)
- `PORT` - Server port (default: 3000)
- `LOG_LEVEL` - Logging level (default: info)

### Volumes

The container mounts the `./logs` directory to persist log files outside the container:
```yaml
volumes:
  - ./logs:/app/logs
```

### Health Checks

The container includes a built-in health check that verifies the API is responding:
- Interval: 30 seconds
- Timeout: 10 seconds
- Start period: 40 seconds

Check container health status:
```bash
docker inspect --format='{{.State.Health.Status}}' magento-migration-api
```

### Troubleshooting Docker

**Container keeps restarting:**
```bash
# Check logs for errors
docker-compose logs --tail=50

# Common issue: logs directory permissions
mkdir -p logs && chmod 777 logs
docker-compose restart
```

**Port already in use:**
```bash
# Change the port mapping in docker-compose.yml
ports:
  - "3001:3000"  # Map to different host port
```

**Build fails with npm error:**
```bash
# Ensure package-lock.json exists
npm install

# Rebuild without cache
docker-compose build --no-cache
```

## Usage

### Start the Server

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

The server will start on `http://localhost:3000` (or the port specified in .env).

## API Endpoints

### Health Check

**GET** `/api/v1/health`

Check if the API server is running.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-01-14T10:30:00Z",
  "uptime": 123.456,
  "environment": "development"
}
```

### Magento Health Check

**GET** `/api/v1/health/magento`

Test connections to both source and target Magento instances.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-01-14T10:30:00Z",
  "connections": {
    "source": {
      "connected": true,
      "url": "https://vapewholesaleusa.com",
      "error": null
    },
    "targets": {
      "ejuices": {
        "connected": true,
        "url": "https://www.ejuices.com",
        "error": null
      },
      "misthub": {
        "connected": true,
        "url": "https://misthub.example.com",
        "error": null
      }
    }
  }
}
```

### Migrate Single Product

**POST** `/api/v1/migrate/product`

Migrate a single product from source Magento to one or more target Magento instances. Automatically detects the product type:

- **Configurable product** (`type_id=configurable`): migrates parent + all child simple products, configurable options, and option links
- **Standalone simple product** (`type_id=simple`, `visibility > 1`): migrates the product as a single standalone product across all store views; no children

**Request Body:**
```json
{
  "sku": "TEST-ABC",
  "options": {
    "includeImages": true,
    "createMissingAttributes": true,
    "overwriteExisting": false,
    "targetMagentoStores": ["ejuices", "misthub"],
    "productEnabled": false,
    "storePrompts": {
      "ejuices": {
        "prompt": "Write for a premium retail audience. Emphasize flavor variety and device quality."
      }
    }
  }
}
```

**Parameters:**
- `sku` (required): The SKU of the product to migrate
- `options` (optional):
  - `includeImages` (boolean, default: true): Whether to migrate product images
  - `createMissingAttributes` (boolean, default: true): Create missing attribute options in target
  - `overwriteExisting` (boolean, default: false): Overwrite existing products
  - `targetMagentoStores` (array of strings): Names of target Magento instances to migrate to (e.g., `["ejuices", "misthub"]`). Required.
  - `productEnabled` (boolean, default: true): Whether to create products as enabled or disabled. Set to `false` to create products in disabled status
  - `storePrompts` (object, optional): Per-store AI content generation prompts. Each key must match a store in `targetMagentoStores`. Each value is an object with a `prompt` field (non-empty string, max 2000 chars). Stores with prompts get AI-generated titles and descriptions; stores without prompts use the original source content. See [Per-Store AI Content Generation](#per-store-ai-content-generation) for details.

**Response (Success - 200):**
```json
{
  "success": true,
  "sku": "TEST-ABC",
  "targetMagentoStores": ["ejuices", "misthub"],
  "instanceResults": {
    "ejuices": {
      "success": true,
      "productId": 12345,
      "childrenCreated": 6,
      "imagesUploaded": 12,
      "aiContentApplied": true
    },
    "misthub": {
      "success": true,
      "productId": 12345,
      "childrenCreated": 6,
      "imagesUploaded": 0,
      "aiContentApplied": false
    }
  },
  "phases": {
    "extraction": {
      "success": true,
      "duration": 2340,
      "childrenFound": 6
    },
    "aiGeneration": {
      "success": true,
      "duration": 8500,
      "storesGenerated": 1
    },
    "preparation": {
      "success": true,
      "duration": 4560,
      "attributesProcessed": 2,
      "optionsCreated": 8
    },
    "creation": {
      "success": true,
      "duration": 8920,
      "childrenCreated": 6,
      "imagesUploaded": 12
    }
  },
  "summary": {
    "totalDuration": 15820,
    "childrenMigrated": 6,
    "errorsCount": 0,
    "warningsCount": 1,
    "instancesSucceeded": 2,
    "instancesFailed": 0
  },
  "warnings": [
    "Attribute 'custom_field' not found in target, skipped"
  ],
  "errors": []
}
```

**Response (Partial Success - 207):**
```json
{
  "success": false,
  "sku": "TEST-ABC",
  "phases": {
    "extraction": { "success": true, "duration": 2340 },
    "preparation": { "success": true, "duration": 4560 },
    "creation": {
      "success": false,
      "duration": 6230,
      "childrenCreated": 4,
      "childrenFailed": 2
    }
  },
  "summary": {
    "totalDuration": 13130,
    "childrenMigrated": 4,
    "errorsCount": 2,
    "warningsCount": 3
  },
  "warnings": [],
  "errors": [
    {
      "phase": "creation",
      "message": "Failed to create simple product",
      "details": "..."
    }
  ]
}
```

### Batch Migration

**POST** `/api/v1/migrate/products/batch`

Migrate multiple configurable products sequentially. Supports `storePrompts` — the same prompts are applied to every SKU in the batch.

**Request Body:**
```json
{
  "skus": ["SKU-001", "SKU-002", "SKU-003"],
  "options": {
    "includeImages": true,
    "createMissingAttributes": true,
    "targetMagentoStores": ["ejuices", "misthub"],
    "storePrompts": {
      "ejuices": {
        "prompt": "Write for a premium retail audience."
      }
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "totalProducts": 3,
  "successCount": 2,
  "failureCount": 1,
  "results": [
    { "sku": "SKU-001", "success": true, "phases": {...} },
    { "sku": "SKU-002", "success": true, "phases": {...} },
    { "sku": "SKU-003", "success": false, "errors": [...] }
  ],
  "summary": {
    "totalDuration": 45240,
    "totalErrors": 3,
    "totalWarnings": 7
  }
}
```

### Sync Prices

**POST** `/api/v1/sync/prices`

Synchronize prices from source Magento to target Magento stores and/or Shopify stores. Fetches current prices from source and updates them on all specified target platforms.

Supports both **configurable products** (syncs all child variant prices) and **standalone simple products** (treated as a single variant — `variantCount` will be 1).

**Request Body:**
```json
{
  "sku": "TEST-ABC",
  "options": {
    "targetMagentoStores": ["ejuices", "misthub"],
    "targetShopifyStores": ["store1"],
    "includeMagento": true,
    "includeShopify": true
  }
}
```

**Parameters:**
- `sku` (required): The SKU of the product whose prices to sync (configurable or standalone simple)
- `options` (optional):
  - `targetMagentoStores` (array of strings): Names of target Magento instances (e.g., `["ejuices", "misthub"]`). If omitted, syncs to all configured Magento instances
  - `targetShopifyStores` (array of strings): Target Shopify store names from `SHOPIFY_STORES` config. If omitted, syncs to all configured Shopify stores
  - `includeMagento` (boolean, default: true): Whether to sync prices to Magento
  - `includeShopify` (boolean, default: true): Whether to sync prices to Shopify

**Response (Success - 200):**
```json
{
  "success": true,
  "sku": "TEST-ABC",
  "variantCount": 6,
  "results": {
    "magento": {
      "default": { "success": true, "variantsUpdated": 6 },
      "misthub": { "success": true, "variantsUpdated": 6 }
    },
    "shopify": {
      "store1": { "success": true, "variantsUpdated": 6 }
    }
  },
  "errors": [],
  "warnings": []
}
```

**Response (Partial Failure - 207):**
```json
{
  "success": false,
  "sku": "TEST-ABC",
  "variantCount": 6,
  "results": {
    "magento": {
      "default": { "success": true, "variantsUpdated": 6 },
      "misthub": { "success": false, "error": "Connection timeout" }
    }
  },
  "errors": [
    { "store": "misthub", "message": "Connection timeout" }
  ],
  "warnings": []
}
```

**Example:**
```bash
# Sync prices to default Magento stores from config
curl -X POST http://localhost:3000/api/v1/sync/prices \
  -H "Content-Type: application/json" \
  -d '{"sku": "TEST-ABC"}'

# Sync to specific instances, Magento only
curl -X POST http://localhost:3000/api/v1/sync/prices \
  -H "Content-Type: application/json" \
  -d '{
    "sku": "TEST-ABC",
    "options": {
      "targetMagentoStores": ["ejuices", "misthub"],
      "includeShopify": false
    }
  }'
```

**Special Price Sync:**

The sync service reads the source product's `special_price` custom attribute and propagates it to all targets:

| Target | `price` | `special_price` / `compareAtPrice` |
|--------|---------|-------------------------------------|
| **Magento** | regular price | `special_price` (null clears any existing value) |
| **Shopify (non-tier store)** | `special_price` (if valid) | `compareAtPrice` = regular price |
| **Shopify (non-tier store, no special price)** | regular price | `compareAtPrice` = null (cleared) |
| **Shopify (tier store)** | tier price for configured group | existing `compareAtPrice` logic unchanged |

A `special_price` is considered valid when it is a positive number **and** less than the regular price. If `special_price >= price`, it is ignored on the Shopify path (treated as no special price) and a warning is logged; on the Magento path it is synced as-is.

**Note:** Price sync uses scoped Magento API endpoints (`/rest/{storeCode}/V1/products`) to ensure prices are updated for each store view individually. Non-scoped updates only affect the global/default price and don't propagate to store views with existing price overrides.

**Tier Pricing (Wholesale):** You can configure specific stores to use tier prices (e.g., wholesale pricing) instead of base prices. Set the `PRICE_SYNC_STORE_GROUP_MAP` environment variable to map store names to Magento customer group IDs:

```env
# Format: store1:groupId1,store2:groupId2
PRICE_SYNC_STORE_GROUP_MAP=ejuicesco:2,wholesale:3
```

When syncing prices to a mapped store, the service will use the tier price for that customer group (with qty=1) if available, falling back to the base price if no tier price exists. Unmapped stores always use the base price.

### Sync Product Fields

**POST** `/api/v1/sync/product-fields`

Push a fixed set of content fields from source Magento to one or more target Magento instances and/or Shopify stores. The source of truth is always the source Magento instance. Supports both **configurable products** and **standalone simple products**.

**Fields always updated (no per-field selection):**

| Field | Source (Magento) | Target Magento | Target Shopify |
|-------|-----------------|----------------|----------------|
| Product name | `name` | `name` (global scope) | `title` |
| Brand | `brand` custom attribute | `brand` custom attribute | `vendor` |
| Categories | `category_ids` / `category_links` | `extension_attributes.category_links` | `productType` |
| Images | `media_gallery_entries` | replaces all existing media | replaces all existing media |
| Description | `description` custom attribute | `description` custom attribute (global scope) | `descriptionHtml` |
| SEO meta title | `meta_title` | `meta_title` (global scope) | `seo.title` |
| SEO meta keywords | `meta_keyword` | `meta_keyword` (global scope) | `tags` (split by comma) |
| SEO meta description | `meta_description` | `meta_description` (global scope) | `seo.description` |

**How it works:**

1. **Extraction** — source product is fetched once from source Magento. If not found, the request fails immediately.
2. **Magento update (per target instance):**
   - Checks the product exists on the target; skips with `success: false` if not found
   - Translates brand label to the target instance's option ID
   - Maps source category names to target category IDs using the category mapping config
   - Writes all fields (brand, categories, name, description, SEO) via a single `/rest/all/V1/products/{sku}` PUT (global scope — inherited by all store views)
   - Deletes all existing images, then re-uploads source images
3. **Shopify update (per store):**
   - For configurable products: looks up the product by first child variant SKU
   - For standalone simple products: looks up the product by the product SKU directly
   - Skips with `success: false` if not found
   - Updates title, vendor, productType, descriptionHtml, tags, and SEO via `productUpdate` GraphQL mutation
   - Deletes all existing media, then uploads new images via source Magento URLs
   - Image replace failures are non-fatal: captured as a warning, text fields remain updated
4. **Notifications** — Google Chat notification sent after extraction (start) and after all stores complete (end)

**Request Body:**
```json
{
  "sku": "PARENT-SKU",
  "options": {
    "targetMagentoStores": ["ejuices"],
    "targetShopifyStores": ["wholesale"],
    "includeMagento": true,
    "includeShopify": true
  }
}
```

**Parameters:**
- `sku` (required): The SKU of the product on source Magento. For configurable products, pass the parent SKU.
- `options` (optional):
  - `targetMagentoStores` (array of strings): Names of target Magento instances to update. Defaults to **all configured Magento instances** when omitted.
  - `targetShopifyStores` (array of strings): Names of target Shopify stores to update. Defaults to all configured Shopify stores when omitted.
  - `includeMagento` (boolean, default: `true`): Whether to update Magento targets.
  - `includeShopify` (boolean, default: `true`): Whether to update Shopify targets.

> Omitting both store lists with just `{ "sku": "X" }` will push to every configured store on all platforms.

**Response (Success - 200):** All stores updated successfully.
```json
{
  "success": true,
  "sku": "PARENT-SKU",
  "results": {
    "magento": {
      "ejuices": { "success": true, "warnings": [] }
    },
    "shopify": {
      "wholesale": { "success": true, "warnings": [] }
    }
  },
  "errors": [],
  "warnings": []
}
```

**Response (Partial Failure - 207):** One or more stores failed or had warnings.
```json
{
  "success": false,
  "sku": "PARENT-SKU",
  "results": {
    "magento": {
      "ejuices": {
        "success": false,
        "error": "Product not found in target store"
      }
    },
    "shopify": {
      "wholesale": {
        "success": true,
        "warnings": [
          { "field": "images", "message": "Image replace failed: network timeout" }
        ]
      }
    }
  },
  "errors": [
    { "store": "ejuices", "message": "Product not found in target store" }
  ],
  "warnings": [
    { "store": "wholesale", "field": "images", "message": "Image replace failed: network timeout" }
  ]
}
```

**Per-store warnings (non-fatal):**
- Brand translation failure on Magento — brand field skipped, update continues
- Category mapping failure on Magento — category update skipped, update continues
- Image replace failure on Shopify — warning recorded, text fields already written, store result remains `success: true`
- Image replace failure on Magento — warning recorded, update continues

**HTTP status:**
- `200` — `success: true` (all stores succeeded, no errors)
- `207` — `success: false` (any per-store failure, any entry in `errors[]`, or both)

**Example:**
```bash
# Update a specific configurable product to one Magento instance and one Shopify store
curl -X POST http://localhost:3000/api/v1/sync/product-fields \
  -H "Content-Type: application/json" \
  -d '{
    "sku": "Palax KC8000 Disposable",
    "options": {
      "targetMagentoStores": ["ejuices"],
      "targetShopifyStores": ["wholesale"]
    }
  }'

# Push to all configured stores on all platforms (no options needed)
curl -X POST http://localhost:3000/api/v1/sync/product-fields \
  -H "Content-Type: application/json" \
  -d '{ "sku": "Palax KC8000 Disposable" }'

# Magento only
curl -X POST http://localhost:3000/api/v1/sync/product-fields \
  -H "Content-Type: application/json" \
  -d '{
    "sku": "Palax KC8000 Disposable",
    "options": {
      "includeShopify": false
    }
  }'
```

> **Note on `admin` store view:** Magento's `admin` store view returns a 400 when updated via a scoped REST endpoint — this is expected Magento behavior and does not affect the product. It appears as a per-store warning, not a failure.

---

### Generate Product Description

**POST** `/api/v1/products/generate-description`

Generate an AI-powered SEO-optimized product description using OpenAI GPT-4o. Fetches the product and its variant flavors from the source Magento store, generates an HTML description with flavor details and features, and updates the product's `description` and `meta_keyword` fields.

**Request Body:**
```json
{
  "sku": "TEST-ABC"
}
```

**Parameters:**
- `sku` (required): The SKU of the configurable product to generate a description for

**Response (Success - 200):**
```json
{
  "success": true,
  "data": {
    "sku": "TEST-ABC",
    "title": "Product Name 50K Puff Disposable",
    "flavorsFound": 15,
    "description": "<div><h2>Product Name...</h2></div><div><p>...</p><ul>...</ul></div>",
    "keywords": "keyword1, keyword2, keyword3, ...",
    "updatedAt": "2026-01-27T00:17:12.059Z"
  }
}
```

**Response (Error - 404):**
```json
{
  "success": false,
  "error": {
    "code": "PRODUCT_NOT_FOUND",
    "message": "Product with SKU 'TEST-ABC' not found"
  }
}
```

**Generated Content:**

The AI generates:
1. **Description HTML** - A 5-sentence SEO-optimized product description with:
   - Product title as H2 heading
   - Informative, professional description paragraph
   - Flavor list with vivid descriptions (bold flavor names)
   - Features bullet list

2. **Meta Keywords** - 15 comma-separated SEO keywords relevant to the product

**Example:**
```bash
curl -X POST http://localhost:3000/api/v1/products/generate-description \
  -H "Content-Type: application/json" \
  -d '{"sku": "VAPE-PRODUCT-123"}'
```

**Configuration:**

Requires OpenAI API key in environment variables:
```env
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_MODEL=gpt-4o  # Optional, defaults to gpt-4o
```

**Error Codes:**
| Code | HTTP Status | Description |
|------|-------------|-------------|
| `PRODUCT_NOT_FOUND` | 404 | Product SKU doesn't exist in source Magento |
| `AI_GENERATION_FAILED` | 502 | OpenAI API call failed after retries |
| `AI_RATE_LIMITED` | 429 | OpenAI rate limit exceeded |
| `UPDATE_FAILED` | 502 | Failed to update product in Magento |

## Per-Store AI Content Generation

During migration, you can provide per-store prompts to generate customized product titles and descriptions for each target store using OpenAI. This is useful when different stores serve different audiences (e.g., wholesale vs. retail).

### How It Works

1. **Extraction** — product data is extracted from source Magento (as usual)
2. **AI Generation** — for each store with a prompt in `storePrompts`, OpenAI generates a customized title and description based on the original product content and your prompt
3. **Creation** — each store receives its customized content; stores without prompts get the original source content unchanged

AI generation runs **before** any product creation. If any AI call fails, the entire migration aborts — no products are created on any store.

### Usage

Add `storePrompts` to the migration request options:

```json
{
  "sku": "KUMI Oro 40K Puffs Disposable Vape",
  "options": {
    "targetMagentoStores": ["staging", "ejuices"],
    "storePrompts": {
      "staging": {
        "prompt": "Write for a wholesale B2B audience. Use professional language focused on bulk pricing value and retailer benefits."
      },
      "ejuices": {
        "prompt": "Write for a premium direct-to-consumer audience. Emphasize flavor experience and device quality."
      }
    }
  }
}
```

### Rules

- `storePrompts` is optional. If omitted, migration works exactly as before.
- Each key must match a store name in `targetMagentoStores`. Unknown store keys are a validation error.
- Each entry must have a `prompt` field (non-empty string, max 2000 characters).
- Only the parent product title and description are customized. Child variant names are unchanged.
- Works for both configurable and standalone simple products.
- Works with batch migrations — the same prompts apply to every SKU.
- Only supported on Magento migration endpoints (not Shopify).

### Response

When `storePrompts` is used, the response includes:

- `phases.aiGeneration` — `{ success, duration, storesGenerated }` tracking the AI generation phase
- `instanceResults.<store>.aiContentApplied` — `true` for stores that received AI content, `false` for stores that used original content

### Example

```bash
curl -X POST http://localhost:3000/api/v1/migrate/product \
  -H "Content-Type: application/json" \
  -d '{
    "sku": "KUMI Oro 40K Puffs Disposable Vape",
    "options": {
      "targetMagentoStores": ["staging"],
      "storePrompts": {
        "staging": {
          "prompt": "Write for a wholesale B2B audience. Emphasize bulk pricing value and device specs."
        }
      }
    }
  }'
```

---

## Migration Process

The migration follows a 3-phase approach:

### Phase 1: Extraction
- Fetch configurable product from source Magento
- Get all linked simple products
- Translate IDs to human-readable names:
  - Attribute sets
  - Attributes
  - Attribute values/options
  - Categories
  - Custom attributes

### Phase 2: Preparation
- Find or create attribute sets in target
- For each attribute value:
  - Search for option by label in target
  - If not found, create new option via API
  - Store new option ID mapping

### Phase 3: Creation
1. **Create Simple Products**
   - Map attributes with new target IDs
   - POST to create each simple product
   - Download images from source
   - Upload images to target

2. **Create Configurable Parent**
   - Create configurable product
   - Upload parent images

3. **Define Configurable Options**
   - POST to `/V1/configurable-products/{sku}/options`
   - Specify which attributes are configurable (color, size, etc.)

4. **Link Children**
   - POST to `/V1/configurable-products/{sku}/child`
   - Link each simple product to parent

## Examples

### Using curl

Test health:
```bash
curl http://localhost:3000/api/v1/health
```

Test Magento connections:
```bash
curl http://localhost:3000/api/v1/health/magento
```

Migrate a product:
```bash
curl -X POST http://localhost:3000/api/v1/migrate/product \
  -H "Content-Type: application/json" \
  -d '{
    "sku": "TEST-ABC",
    "options": {
      "includeImages": true,
      "productEnabled": false,
      "targetMagentoStores": ["ejuices"]
    }
  }'
```

Batch migration:
```bash
curl -X POST http://localhost:3000/api/v1/migrate/products/batch \
  -H "Content-Type: application/json" \
  -d '{
    "skus": ["SKU-001", "SKU-002"],
    "options": {
      "includeImages": true
    }
  }'
```

## Shopify Migration

The API supports migrating Magento configurable products to Shopify stores using the Shopify GraphQL Admin API.

### How It Works

Magento configurable products are transformed to Shopify products:
- Magento parent product → Shopify product
- Magento simple children → Shopify variants
- Configurable attributes (color, size) → Shopify product options

### Configuration

**Environment Variables:**

```env
SHOPIFY_API_VERSION=2025-01
SHOPIFY_DEFAULT_STORE=test

# Pattern: SHOPIFY_STORE_<NAME>_URL and SHOPIFY_STORE_<NAME>_TOKEN
SHOPIFY_STORE_TEST_URL=vwu-test-store.myshopify.com
SHOPIFY_STORE_TEST_TOKEN=shpat_xxxxx
```

### Shopify Health Check

**GET** `/api/v1/health/shopify`

Test connection to Shopify store.

**Query Parameters:**
- `store` (optional): Name of the store from `SHOPIFY_STORES` config

```bash
# Test default store
curl http://localhost:3000/api/v1/health/shopify

# Test specific store
curl http://localhost:3000/api/v1/health/shopify?store=store1
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-01-19T10:30:00Z",
  "connection": {
    "connected": true,
    "shopDomain": "mystore.myshopify.com",
    "shopName": "My Store",
    "shopUrl": "https://mystore.myshopify.com",
    "error": null
  }
}
```

### Migrate Product to Shopify

**POST** `/api/v1/migrate/product/shopify`

Migrate a Magento product to Shopify. Automatically detects product type:

- **Configurable product**: migrated as a Shopify product with multiple variants and product options
- **Standalone simple product**: migrated as a single-variant Shopify product with no explicit options (Shopify default "Title / Default Title")

**Request Body:**
```json
{
  "sku": "MAGENTO-SKU-123",
  "options": {
    "includeImages": true,
    "shopifyStore": "store1",
    "productStatus": "ACTIVE"
  }
}
```

**Parameters:**
- `sku` (required): The SKU of the Magento product to migrate
- `options` (optional):
  - `includeImages` (boolean, default: from config): Whether to migrate product images
  - `shopifyStore` (string): Name of the target Shopify store from `SHOPIFY_STORES` config
  - `productStatus` (string, default: "DRAFT"): Shopify product status. Valid values: `"DRAFT"` or `"ACTIVE"`

**Response (Success - 200):**
```json
{
  "sku": "MAGENTO-SKU-123",
  "success": true,
  "targetPlatform": "shopify",
  "shopifyStore": "store1",
  "shopifyProductId": "gid://shopify/Product/123456",
  "shopifyProductUrl": "https://store1.myshopify.com/admin/products/123456",
  "phases": {
    "extraction": {
      "success": true,
      "duration": 2340,
      "childrenFound": 6
    },
    "creation": {
      "success": true,
      "duration": 5200,
      "variantsCreated": 6,
      "imagesUploaded": 12
    }
  },
  "summary": {
    "totalDuration": 7540,
    "variantsMigrated": 6,
    "imagesUploaded": 12,
    "errorsCount": 0,
    "warningsCount": 0
  },
  "warnings": [],
  "errors": []
}
```

### Data Mapping

| Magento Field | Shopify Field |
|---------------|---------------|
| `parent.name` | `product.title` |
| `parent.description` | `product.descriptionHtml` |
| `parent.sku` | `product.handle` (slugified) |
| `parent.meta_keyword` | `product.tags` (comma-separated) |
| `child.sku` | `variant.sku` |
| `child.price` | `variant.price` |
| `child.weight` | `variant.weight` |
| Configurable options | `product.options` |
| `media_gallery_entries` | `product.media` |

### Shopify API Considerations

1. **Rate Limiting**: Shopify uses cost-based throttling (~1000 points/second). The client handles retry-after headers automatically.

2. **Variant Limits**: Shopify allows max 100 variants per product and 3 options (e.g., color, size, material).

3. **Image Upload**: Images are uploaded via URL from the source Magento media directory.

4. **Product Status**: Products are created in DRAFT status by default. Use `productStatus: "ACTIVE"` to create products as active immediately.

### Example: Shopify Migration

```bash
curl -X POST http://localhost:3000/api/v1/migrate/product/shopify \
  -H "Content-Type: application/json" \
  -d '{
    "sku": "TEST-ABC",
    "options": {
      "includeImages": true,
      "shopifyStore": "mystore",
      "productStatus": "ACTIVE"
    }
  }'
```

## Standalone Simple Product Migration

The API automatically detects and handles standalone simple products — Magento products with `type_id=simple` and `visibility > 1` (visible in catalog/search, not a configurable child).

### How It Works

1. **Type probe**: before starting migration, the orchestrator fetches the source product once and classifies it as `configurable` or `standalone-simple`
2. **Standalone extraction**: extracts the product data, images, categories, and attribute translations — no children
3. **Creation (Magento)**: creates the product globally via `/rest/all/V1/products`, then updates store-scoped attributes for each additional store view
4. **Creation (Shopify)**: creates a single-variant product using Shopify's `productSet` mutation with a default "Title / Default Title" option

### Example: Magento

```bash
curl -X POST http://localhost:3000/api/v1/migrate/product \
  -H "Content-Type: application/json" \
  -d '{
    "sku": "STANDALONE-SKU-123",
    "options": {
      "includeImages": true,
      "targetMagentoStores": ["ejuices"]
    }
  }'
```

**Response:**
```json
{
  "success": true,
  "sku": "STANDALONE-SKU-123",
  "targetMagentoStores": ["ejuices"],
  "instanceResults": {
    "ejuices": {
      "success": true,
      "mode": "standalone-creation",
      "productId": 72989,
      "childrenCreated": 0,
      "storeResults": {
        "default": { "success": true, "productId": 72989, "imagesUploaded": 1, "mode": "standalone-creation" },
        "admin":   { "success": false, "error": "Specified request cannot be processed.", "mode": "store-update" },
        "store2":  { "success": true, "productId": 72989, "mode": "store-update" }
      }
    }
  }
}
```

> **Note:** The `admin` store view always returns a 400 from Magento when updating via the scoped REST endpoint — this is expected Magento behavior and does not affect the product.

### Example: Shopify

```bash
curl -X POST http://localhost:3000/api/v1/migrate/product/shopify \
  -H "Content-Type: application/json" \
  -d '{
    "sku": "STANDALONE-SKU-123",
    "options": {
      "includeImages": true,
      "shopifyStore": "mystore"
    }
  }'
```

**Response:**
```json
{
  "success": true,
  "sku": "STANDALONE-SKU-123",
  "targetPlatform": "shopify",
  "shopifyStore": "mystore",
  "shopifyProductId": "gid://shopify/Product/8503655497863",
  "shopifyProductUrl": "https://mystore.myshopify.com/admin/products/8503655497863"
}
```

---

## Multi-Instance Magento Migration

The API supports migrating products to multiple independent Magento instances in a single operation. Each Magento instance is configured with its own URL and API token, allowing you to manage separate Magento installations (e.g., ejuices.com, misthub.com) from a single migration service.

### How It Works

Each target Magento instance is registered via environment variables using the pattern `MAGENTO_STORE_<NAME>_URL` and `MAGENTO_STORE_<NAME>_TOKEN`. When you specify target instances in a migration request, the API:

1. Extracts product data from the source (once)
2. For each target instance:
   - Prepares attribute mappings for that instance
   - Auto-discovers all store views within the instance
   - Creates products on all store views within the instance
   - Uploads images (once per instance, as they are shared across store views)

### Instance Configuration

**Environment variables (one pair per Magento instance):**
```env
MAGENTO_STORE_EJUICES_URL=https://www.ejuices.com/
MAGENTO_STORE_EJUICES_TOKEN=your_ejuices_token

MAGENTO_STORE_MISTHUB_URL=https://misthub.example.com/
MAGENTO_STORE_MISTHUB_TOKEN=your_misthub_token
```

The `<NAME>` portion (e.g., `EJUICES`, `MISTHUB`) becomes the instance identifier used in API requests (lowercased: `ejuices`, `misthub`).

**Per-request targeting:**
```json
{
  "sku": "TEST-ABC",
  "options": {
    "targetMagentoStores": ["ejuices", "misthub"]
  }
}
```

The `targetMagentoStores` array specifies which configured Magento instances to migrate to.

### Example: Multi-Instance Migration

```bash
curl -X POST http://localhost:3000/api/v1/migrate/product \
  -H "Content-Type: application/json" \
  -d '{
    "sku": "TEST-ABC",
    "options": {
      "includeImages": true,
      "targetMagentoStores": ["ejuices", "misthub"]
    }
  }'
```

**Response:**
```json
{
  "success": true,
  "sku": "TEST-ABC",
  "targetMagentoStores": ["ejuices", "misthub"],
  "instanceResults": {
    "ejuices": {"success": true, "productId": 12345, "childrenCreated": 4, "imagesUploaded": 5},
    "misthub": {"success": true, "productId": 12346, "childrenCreated": 4, "imagesUploaded": 5}
  },
  "summary": {
    "instancesSucceeded": 2,
    "instancesFailed": 0
  }
}
```

### Notes

- **Store views within each instance**: The API auto-discovers store views for each Magento instance and creates the product across all of them. You do not need to specify individual store view codes.
- **Images**: Uploaded once per instance, as images are shared across store views within a single Magento installation.
- **Error handling**: Per-instance failures are tracked individually; migration continues to remaining instances if `CONTINUE_ON_ERROR=true`.

## Logging

Logs are stored in the `logs/` directory:

- `error-YYYY-MM-DD.log` - Error-level logs only
- `combined-YYYY-MM-DD.log` - All logs
- `migration-YYYY-MM-DD.log` - Migration-specific logs

Logs rotate daily and are kept for 30 days.

## Configuration

All configuration is done via environment variables in the `.env` file:

```env
# Server
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug

# Source Magento
SOURCE_MAGENTO_BASE_URL=https://source.magento.com
SOURCE_MAGENTO_TOKEN=your_token

# Target Magento Stores (add as many as needed)
MAGENTO_STORE_EJUICES_URL=https://www.ejuices.com/
MAGENTO_STORE_EJUICES_TOKEN=your_token
MAGENTO_STORE_MISTHUB_URL=https://misthub.example.com/
MAGENTO_STORE_MISTHUB_TOKEN=your_token

# API Settings
API_TIMEOUT=30000
MAX_RETRIES=3
RETRY_DELAY=1000

# Concurrency
MAX_CONCURRENT_REQUESTS=5
MAX_IMAGE_SIZE_MB=10

# Migration Defaults
DEFAULT_INCLUDE_IMAGES=true
DEFAULT_CREATE_MISSING_ATTRIBUTES=true
CONTINUE_ON_ERROR=true

# OpenAI (for AI-powered descriptions)
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_MODEL=gpt-4o  # Optional, defaults to gpt-4o

# Price Sync
PRICE_SYNC_STORE_GROUP_MAP=ejuicesco:2  # Optional: map stores to customer group IDs for tier pricing
```

## Google Chat Notifications

The API can send real-time notifications to Google Chat when migrations and price syncs start and complete.

### Notification Types

**Migration Start**
- Sent when a product migration begins
- Shows parent SKU and list of child SKUs being migrated

**Migration Complete**
- Sent when migration finishes (success or failure)
- Shows status, duration, and children migrated count
- Includes error details if migration failed
- Provides a "View Product in Magento" button linking directly to the product admin page

**Price Sync Start**
- Sent when a price sync begins
- Shows SKU, variant count, and target stores

**Price Sync Complete**
- Sent when price sync finishes (success or failure)
- Shows SKU, status, duration, and updated prices
- Lists variant SKUs with their new prices (up to 10 shown)
- Includes error details if sync failed

**Product Fields Update Start**
- Sent after successful extraction from source Magento, before any store updates begin
- Shows SKU and list of target stores

**Product Fields Update Complete**
- Sent after all stores finish (success or failure)
- Shows SKU, overall status, duration, and any errors
- Also sent if an unexpected error occurs mid-update

### Setup

1. **Create a Google Chat Webhook**
   - Open Google Chat and go to the space where you want notifications
   - Click the space name > Apps & integrations > Webhooks
   - Click "Create webhook", give it a name, and copy the webhook URL

2. **Configure Environment Variables**

Add to your `.env` file:
```env
# Google Chat Notifications
GOOGLE_CHAT_ENABLED=true
GOOGLE_CHAT_WEBHOOK_URL=https://chat.googleapis.com/v1/spaces/SPACE_ID/messages?key=KEY&token=TOKEN
GOOGLE_CHAT_TIMEOUT=5000
```

### Configuration Options

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_CHAT_ENABLED` | Enable/disable notifications | `false` |
| `GOOGLE_CHAT_WEBHOOK_URL` | Webhook URL from Google Chat | (required if enabled) |
| `GOOGLE_CHAT_TIMEOUT` | Request timeout in milliseconds | `5000` |

## Error Handling

The API uses a continue-on-error pattern:
- Non-critical errors are logged but don't stop the migration
- Each phase reports its own success/failure
- Detailed error information is returned in the response
- Check `errors` and `warnings` arrays in the response

## Troubleshooting

### Connection Errors

If health check fails:
1. Verify Magento URLs are correct
2. Check that API tokens are valid
3. Ensure network connectivity to Magento instances

### Migration Failures

If migration fails:
1. Check logs in `logs/migration-YYYY-MM-DD.log`
2. Verify the SKU exists in source Magento
3. Ensure attribute set exists in target
4. Check that configurable attributes exist in target

### Image Upload Failures

If images fail to upload:
1. Check image URLs are accessible
2. Verify image file sizes (max 10MB by default)
3. Check target Magento has sufficient storage

### Shopify Variant Sync "Option does not exist" Error

When syncing missing variants to an existing Shopify product, you may encounter:
```
variants.0.optionValues.2: Option does not exist
```

**Cause**: New variants from Magento have more configurable attributes (e.g., Color, Size, Material) than the existing Shopify product has options (e.g., only Color, Size).

**Solution**: The API automatically filters variant option values to only include options that already exist on the Shopify product. Logs will show:
```
Existing Shopify product options: ["Color", "Size"]
```

The variant will be created with only Color and Size values, dropping Material.

### Google Chat Notifications Not Working

If notifications aren't appearing:
1. Verify `GOOGLE_CHAT_ENABLED=true` in your `.env` file
2. Check that the webhook URL is correct and complete
3. Ensure the webhook hasn't been deleted from the Google Chat space
4. Check logs for timeout errors (increase `GOOGLE_CHAT_TIMEOUT` if needed)
5. Verify network connectivity to `chat.googleapis.com`

If the product link is incorrect:
1. Check that the migration completed successfully (product ID is only available on success)

## Architecture

```
src/
├── config/          # Configuration and logging
├── controllers/     # Request handlers
├── middleware/      # Express middleware
├── routes/          # API routes
├── services/
│   ├── magento/     # Magento API clients
│   ├── shopify/     # Shopify GraphQL API clients
│   ├── migration/   # Migration services (extraction, preparation, creation)
│   ├── sync/        # Price sync services
│   ├── ai/          # OpenAI client for AI-powered features
│   └── notification/ # Google Chat notification service
└── utils/           # Utility functions and helpers
```

## Key Services

### Magento Services
- **MagentoClient**: Base HTTP client with retry logic
- **SourceService**: Operations for source Magento
- **TargetService**: Operations for target Magento

### Shopify Services
- **ShopifyClient**: Base GraphQL client for Shopify Admin API with rate limiting
- **ShopifyTargetService**: Product/variant/image operations for Shopify

### Migration Services
- **ExtractionService**: Phase 1 - Extract configurable product data from source Magento
- **StandaloneExtractionService**: Phase 1 - Extract standalone simple product data from source Magento
- **PreparationService**: Phase 2 - Prepare Magento target with attribute mappings
- **CreationService**: Phase 3 - Create configurable products in Magento target
- **StandaloneMagentoCreationService**: Phase 3 - Create standalone simple products in Magento target across all store views
- **ShopifyCreationService**: Transform Magento data and create configurable or standalone products in Shopify
- **OrchestratorService**: Coordinates Magento→Magento migration; auto-detects configurable vs standalone
- **ShopifyOrchestratorService**: Coordinates Magento→Shopify migration; auto-detects configurable vs standalone
- **ImageService**: Download and upload images

### Sync Services
- **PriceSyncService**: Synchronize prices from source to target platforms (Magento and Shopify)
- **ProductUpdateService**: Push content fields (name, brand, categories, images, description, SEO) from source to target platforms (Magento and Shopify)

### AI Services
- **OpenAIClient**: OpenAI API client with retry logic for generating content
- **DescriptionService**: Generate AI-powered product descriptions using product title and flavors
- **ContentGenerationService**: Generate per-store customized titles and descriptions during migration using caller-provided prompts

### Notification Services
- **GoogleChatService**: Send real-time notifications to Google Chat for migrations and price syncs