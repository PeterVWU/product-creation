# Magento Product Migration API

A Node.js REST API server for migrating configurable products from a source Magento instance to target platforms (Magento or Shopify).

## Features

- Migrate configurable products with all their simple product children
- Automatic attribute and attribute value mapping
- Image migration with optimization
- Comprehensive error handling and logging
- Continue-on-error pattern (doesn't stop on non-critical errors)
- Support for batch migrations
- **Multi-store scope support** - migrate products to multiple Magento store views in a single operation
- **Shopify migration support** - migrate Magento products to Shopify stores using GraphQL Admin API
- Health check endpoints
- Real-time Google Chat notifications for migration and price sync status
- **Price synchronization** - sync prices from source to target Magento stores and Shopify
- **AI-powered product descriptions** - generate SEO-optimized descriptions using OpenAI GPT-4o

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

TARGET_MAGENTO_BASE_URL=https://h79xmxgomfk7jkn.ejuices.com
TARGET_MAGENTO_TOKEN=your_target_token
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
- `TARGET_MAGENTO_BASE_URL` - Target Magento instance URL
- `TARGET_MAGENTO_TOKEN` - Target Magento API token
- `TARGET_STORE_CODES` - Comma-separated list of target store codes (optional)
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
      "url": "https://staging.vapewholesaleusa.com",
      "error": null
    },
    "target": {
      "connected": true,
      "url": "https://h79xmxgomfk7jkn.ejuices.com",
      "error": null
    }
  }
}
```

### Migrate Single Product

**POST** `/api/v1/migrate/product`

Migrate a single configurable product from source to target.

**Request Body:**
```json
{
  "sku": "TEST-ABC",
  "options": {
    "includeImages": true,
    "createMissingAttributes": true,
    "overwriteExisting": false,
    "targetStores": ["default", "misthub"],
    "productEnabled": false
  }
}
```

**Parameters:**
- `sku` (required): The SKU of the configurable product to migrate
- `options` (optional):
  - `includeImages` (boolean, default: true): Whether to migrate product images
  - `createMissingAttributes` (boolean, default: true): Create missing attribute options in target
  - `overwriteExisting` (boolean, default: false): Overwrite existing products
  - `targetStores` (array of strings): Target store codes to migrate to (e.g., `["default", "misthub"]`). If omitted, uses `TARGET_STORE_CODES` env var or default endpoint
  - `productEnabled` (boolean, default: true): Whether to create products as enabled or disabled. Set to `false` to create products in disabled status

**Response (Success - 200):**
```json
{
  "success": true,
  "sku": "TEST-ABC",
  "targetStores": ["default", "misthub"],
  "storeResults": {
    "default": {
      "success": true,
      "productId": 12345,
      "childrenCreated": 6,
      "imagesUploaded": 12
    },
    "misthub": {
      "success": true,
      "productId": 12345,
      "childrenCreated": 6,
      "imagesUploaded": 0
    }
  },
  "phases": {
    "extraction": {
      "success": true,
      "duration": 2340,
      "childrenFound": 6
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
    "storesSucceeded": 2,
    "storesFailed": 0
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

Migrate multiple configurable products sequentially.

**Request Body:**
```json
{
  "skus": ["SKU-001", "SKU-002", "SKU-003"],
  "options": {
    "includeImages": true,
    "createMissingAttributes": true,
    "targetStores": ["default", "misthub"]
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

**Request Body:**
```json
{
  "sku": "TEST-ABC",
  "options": {
    "targetMagentoStores": ["default", "misthub"],
    "targetShopifyStores": ["store1"],
    "includeMagento": true,
    "includeShopify": true
  }
}
```

**Parameters:**
- `sku` (required): The SKU of the configurable product whose prices to sync
- `options` (optional):
  - `targetMagentoStores` (array of strings): Target Magento store codes. If omitted, uses `TARGET_STORE_CODES` env var
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

# Sync to specific stores, Magento only
curl -X POST http://localhost:3000/api/v1/sync/prices \
  -H "Content-Type: application/json" \
  -d '{
    "sku": "TEST-ABC",
    "options": {
      "targetMagentoStores": ["default", "misthub", "ejuices"],
      "includeShopify": false
    }
  }'
```

**Note:** Price sync uses scoped Magento API endpoints (`/rest/{storeCode}/V1/products`) to ensure prices are updated for each store view individually. Non-scoped updates only affect the global/default price and don't propagate to store views with existing price overrides.

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
      "productEnabled": false
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
# Default Shopify store (optional)
SHOPIFY_STORE_URL=mystore.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxx

# Multiple stores via JSON (optional)
SHOPIFY_STORES={"store1": {"url": "store1.myshopify.com", "token": "shpat_xxx"}, "store2": {"url": "store2.myshopify.com", "token": "shpat_yyy"}}

# API version (optional, defaults to 2025-01)
SHOPIFY_API_VERSION=2025-01
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

Migrate a Magento configurable product to Shopify.

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
- `sku` (required): The SKU of the Magento configurable product to migrate
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

## Multi-Store Migration

The API supports migrating products to multiple Magento store views in a single operation. This is useful when you need to create store-specific product data.

### How It Works

Magento supports store-scoped API calls using the format `/rest/{storeCode}/V1/products`. When you specify target stores, the API:

1. Extracts product data from the source (once)
2. Prepares attribute mappings (once)
3. Creates products in each target store sequentially
4. Uploads images only once (images are shared across stores in Magento)

### Store Code Configuration

**Option 1: Per-request (recommended for flexibility)**
```json
{
  "sku": "TEST-ABC",
  "options": {
    "targetStores": ["default", "misthub", "ejuices"]
  }
}
```

**Option 2: Environment variable (for consistent defaults)**
```env
TARGET_STORE_CODES=default,misthub,ejuices
```

If both are provided, the per-request `targetStores` takes precedence.

### Finding Available Store Codes

Query your target Magento instance to get available store codes:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://your-magento.com/rest/V1/store/storeViews
```

Response will include store codes like:
```json
[
  {"id": 1, "code": "default", "name": "Default Store View"},
  {"id": 8, "code": "misthub", "name": "Misthub"}
]
```

Use the `code` field value (e.g., `default`, `misthub`) in your `targetStores` array.

### Example: Multi-Store Migration

```bash
curl -X POST http://localhost:3000/api/v1/migrate/product \
  -H "Content-Type: application/json" \
  -d '{
    "sku": "TEST-ABC",
    "options": {
      "includeImages": true,
      "targetStores": ["default", "misthub"]
    }
  }'
```

**Response:**
```json
{
  "success": true,
  "sku": "TEST-ABC",
  "targetStores": ["default", "misthub"],
  "storeResults": {
    "default": {"success": true, "productId": 12345, "childrenCreated": 4, "imagesUploaded": 5},
    "misthub": {"success": true, "productId": 12345, "childrenCreated": 4, "imagesUploaded": 0}
  },
  "summary": {
    "storesSucceeded": 2,
    "storesFailed": 0
  }
}
```

### Notes

- **Backward compatible**: If no `targetStores` and no `TARGET_STORE_CODES` env var, the API uses the default Magento endpoint (`/rest/V1/products`)
- **Images**: Uploaded only once per product (to the first store), as they're shared across stores in Magento
- **Error handling**: Per-store failures are tracked individually; migration continues to remaining stores if `CONTINUE_ON_ERROR=true`

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

# Target Magento
TARGET_MAGENTO_BASE_URL=https://target.magento.com
TARGET_MAGENTO_TOKEN=your_token
TARGET_STORE_CODES=default,misthub,ejuices  # Optional: comma-separated list of target store codes

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

# Admin path for product links (found in your Magento admin URL)
TARGET_MAGENTO_ADMIN_PATH=admin
```

### Configuration Options

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_CHAT_ENABLED` | Enable/disable notifications | `false` |
| `GOOGLE_CHAT_WEBHOOK_URL` | Webhook URL from Google Chat | (required if enabled) |
| `GOOGLE_CHAT_TIMEOUT` | Request timeout in milliseconds | `5000` |
| `TARGET_MAGENTO_ADMIN_PATH` | Magento admin URL path (e.g., `admin` or `admin_xyz123`) | `admin` |

### Finding Your Admin Path

Your Magento admin path is the segment after your domain in the admin URL:
- If your admin URL is `https://example.com/admin/...` → admin path is `admin`
- If your admin URL is `https://example.com/admin_SqwOPu4tsRle/...` → admin path is `admin_SqwOPu4tsRle`

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
1. Verify `TARGET_MAGENTO_ADMIN_PATH` matches your Magento admin URL path
2. Check that the migration completed successfully (product ID is only available on success)

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
- **ExtractionService**: Phase 1 - Extract data from source Magento
- **PreparationService**: Phase 2 - Prepare Magento target with attribute mappings
- **CreationService**: Phase 3 - Create products in Magento target
- **ShopifyCreationService**: Transform Magento data and create products in Shopify
- **OrchestratorService**: Coordinates Magento→Magento migration phases
- **ShopifyOrchestratorService**: Coordinates Magento→Shopify migration phases
- **ImageService**: Download and upload images

### Sync Services
- **PriceSyncService**: Synchronize prices from source to target platforms (Magento and Shopify)

### AI Services
- **OpenAIClient**: OpenAI API client with retry logic for generating content
- **DescriptionService**: Generate AI-powered product descriptions using product title and flavors

### Notification Services
- **GoogleChatService**: Send real-time notifications to Google Chat for migrations and price syncs