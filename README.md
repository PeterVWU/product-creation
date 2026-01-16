# Magento Product Migration API

A Node.js REST API server for migrating configurable products from a source Magento instance to a target Magento instance.

## Features

- Migrate configurable products with all their simple product children
- Automatic attribute and attribute value mapping
- Image migration with optimization
- Comprehensive error handling and logging
- Continue-on-error pattern (doesn't stop on non-critical errors)
- Support for batch migrations
- Health check endpoints

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
    "overwriteExisting": false
  }
}
```

**Parameters:**
- `sku` (required): The SKU of the configurable product to migrate
- `options` (optional):
  - `includeImages` (boolean, default: true): Whether to migrate product images
  - `createMissingAttributes` (boolean, default: true): Create missing attribute options in target
  - `overwriteExisting` (boolean, default: false): Overwrite existing products

**Response (Success - 200):**
```json
{
  "success": true,
  "sku": "TEST-ABC",
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
    "warningsCount": 1
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
    "createMissingAttributes": true
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
      "includeImages": true
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
```

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

## Architecture

```
src/
├── config/          # Configuration and logging
├── controllers/     # Request handlers
├── middleware/      # Express middleware
├── routes/          # API routes
├── services/
│   ├── magento/     # Magento API clients
│   └── migration/   # Migration services (extraction, preparation, creation)
└── utils/           # Utility functions and helpers
```

## Key Services

- **MagentoClient**: Base HTTP client with retry logic
- **SourceService**: Operations for source Magento
- **TargetService**: Operations for target Magento
- **ExtractionService**: Phase 1 - Extract data from source
- **PreparationService**: Phase 2 - Prepare target with attribute mappings
- **CreationService**: Phase 3 - Create products in target
- **ImageService**: Download and upload images
- **OrchestratorService**: Coordinates all migration phases