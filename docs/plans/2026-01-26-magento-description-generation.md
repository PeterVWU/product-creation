# Magento Product Description Generation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an endpoint that generates AI-powered product descriptions using OpenAI GPT-4o and updates Magento products.

**Architecture:** New route → controller → DescriptionService orchestrates fetching product data from TargetService, calling OpenAIClient for generation, then updating the product. Follows existing service patterns.

**Tech Stack:** Express.js, OpenAI SDK (`openai` npm package), existing Magento TargetService

---

## Task 1: Add OpenAI Configuration

**Files:**
- Modify: `src/config/index.js:82-87`

**Step 1: Add OpenAI config section**

Add after the `shopify` config block (line 86), before the closing brace:

```javascript
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o'
  }
```

**Step 2: Verify config loads**

Run: `node -e "require('./src/config'); console.log('Config loaded')"`
Expected: "Config loaded" (OpenAI is optional, so no validation error)

**Step 3: Commit**

```bash
git add src/config/index.js
git commit -m "feat: add OpenAI configuration"
```

---

## Task 2: Add DescriptionGenerationError

**Files:**
- Modify: `src/utils/error-handler.js`

**Step 1: Add error class**

Add before `module.exports` (after ShopifyAPIError class):

```javascript
class DescriptionGenerationError extends Error {
  constructor(message, code, statusCode = 500, details = null) {
    super(message);
    this.name = 'DescriptionGenerationError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}
```

**Step 2: Export the new error**

Update the `module.exports` to include `DescriptionGenerationError`:

```javascript
module.exports = {
  MagentoAPIError,
  ExtractionError,
  PreparationError,
  CreationError,
  ValidationError,
  ImageProcessingError,
  ShopifyAPIError,
  DescriptionGenerationError
};
```

**Step 3: Add error handling in middleware**

Modify `src/middleware/error.middleware.js`. Add import:

```javascript
const {
  MagentoAPIError,
  ValidationError,
  ExtractionError,
  PreparationError,
  CreationError,
  ImageProcessingError,
  DescriptionGenerationError
} = require('../utils/error-handler');
```

Add handler before the final catch-all (before line 50):

```javascript
  if (err instanceof DescriptionGenerationError) {
    return res.status(err.statusCode || 500).json({
      success: false,
      error: {
        code: err.code,
        message: err.message
      },
      details: process.env.NODE_ENV === 'development' ? err.details : undefined
    });
  }
```

**Step 4: Commit**

```bash
git add src/utils/error-handler.js src/middleware/error.middleware.js
git commit -m "feat: add DescriptionGenerationError class"
```

---

## Task 3: Create OpenAI Client

**Files:**
- Create: `src/services/ai/openai.client.js`

**Step 1: Create the ai directory**

```bash
mkdir -p src/services/ai
```

**Step 2: Create OpenAI client**

```javascript
const OpenAI = require('openai');
const config = require('../../config');
const logger = require('../../config/logger');
const { DescriptionGenerationError } = require('../../utils/error-handler');

class OpenAIClient {
  constructor() {
    if (!config.openai.apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    this.client = new OpenAI({ apiKey: config.openai.apiKey });
    this.model = config.openai.model;
    this.maxRetries = 3;
    this.retryDelay = 1000;
  }

  async generateDescription(prompt) {
    let lastError;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.debug('Calling OpenAI API', { model: this.model, attempt });

        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error('Empty response from OpenAI');
        }

        logger.info('OpenAI response received', {
          model: this.model,
          tokens: response.usage?.total_tokens
        });

        return content;
      } catch (error) {
        lastError = error;
        logger.warn('OpenAI API call failed', {
          attempt,
          error: error.message,
          status: error.status
        });

        if (error.status === 429) {
          throw new DescriptionGenerationError(
            'OpenAI rate limit exceeded',
            'AI_RATE_LIMITED',
            429,
            { originalError: error.message }
          );
        }

        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          logger.debug('Retrying after delay', { delay });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new DescriptionGenerationError(
      'Failed to generate description after retries',
      'AI_GENERATION_FAILED',
      502,
      { originalError: lastError?.message }
    );
  }
}

module.exports = OpenAIClient;
```

**Step 3: Commit**

```bash
git add src/services/ai/openai.client.js
git commit -m "feat: add OpenAI client with retry logic"
```

---

## Task 4: Create Description Service

**Files:**
- Create: `src/services/description.service.js`

**Step 1: Create the service**

```javascript
const OpenAIClient = require('./ai/openai.client');
const TargetService = require('./magento/target.service');
const config = require('../config');
const logger = require('../config/logger');
const { DescriptionGenerationError } = require('../utils/error-handler');

const PROMPT_TEMPLATE = `Write a 5 sentence description for {title}. This is a web listing that should be seo-optimized. Voice should be informative and professional, emphasizing key product features.

Reference the flavor list below for a concise flavor description for each of the following using vivid and highly sensuous language in a simple bulleted list format. Bold the flavor names. Reference example format attached. Also include a features section based on your findings.

Include 15 SEO keywords relevant to this product at the end.

FLAVORS:
{flavors}

Example:
<div>Nexa Ultra V2 50K Puffs Disposable Vape</div>
<div>
    <p>"Experience next-level vaping with the Nexa Ultra V2 50K Puffs Disposable Vape Device, engineered for performance, longevity, and an unmatched flavor experience. Boasting an impressive 50,000 puff capacity, this powerhouse is built for extended use, supported by a reliable 900mAh rechargeable battery that ensures consistent output across sessions. The device offers customizable inhalation with both Normal and Boost Modes, letting users switch between smooth draws and more intense hits depending on their preference. A dynamic LED screen provides real-time updates on battery life, puff count, and mode selection, all easily viewable in any lighting condition thanks to its innovative Dark Mode feature. Choose from a wide array of vibrant, expertly blended flavors that deliver rich, layered profiles with every puff, making the Nexa Ultra V2 a standout choice for discerning vapers seeking both style and substance.</p>

    <p><strong>Flavors:</strong></p>
    <ul>
        <li><strong>Watermelon Ice:</strong> A lush burst of sun-ripened watermelon floods the senses, chased by a crystalline wave of icy menthol that tingles and refreshes with every exhale.</li>
        <li><strong>Strawberry Mango:</strong> Velvety strawberries swirl with golden mango nectar in a tropical duet that's sweet, juicy, and dripping with exotic indulgence.</li>
    </ul>

    <p><strong>Features:</strong></p>
    <ul>
        <li>Up to 50,000 Puffs</li>
        <li>900mAh Rechargeable Battery</li>
    </ul>
</div>`;

const PROMPT_TEMPLATE_NO_FLAVORS = `Write a 5 sentence description for {title}. This is a web listing that should be seo-optimized. Voice should be informative and professional, emphasizing key product features.

Also include a features section based on your findings.

Include 15 SEO keywords relevant to this product at the end.

Format the output as HTML with a <div> wrapper containing a <p> for the description and a <ul> for features.`;

class DescriptionService {
  constructor() {
    this.openaiClient = new OpenAIClient();
    this.targetService = new TargetService(
      config.target.baseUrl,
      config.target.token
    );
  }

  async generateAndUpdateDescription(sku) {
    logger.info('Starting description generation', { sku });

    // Step 1: Fetch product from target Magento
    const product = await this.targetService.getProductBySku(sku);
    if (!product) {
      throw new DescriptionGenerationError(
        `Product with SKU '${sku}' not found`,
        'PRODUCT_NOT_FOUND',
        404
      );
    }

    const title = product.name;
    logger.info('Product found', { sku, title });

    // Step 2: Get configurable children and extract flavors
    const children = await this.targetService.getConfigurableChildren(sku);
    const flavors = this.extractFlavors(children);
    logger.info('Flavors extracted', { sku, count: flavors.length });

    // Step 3: Build prompt and generate description
    const prompt = this.buildPrompt(title, flavors);
    const description = await this.openaiClient.generateDescription(prompt);
    logger.info('Description generated', { sku, length: description.length });

    // Step 4: Update product with new description
    await this.updateProductDescription(sku, description);
    logger.info('Product description updated', { sku });

    return {
      sku,
      title,
      flavorsFound: flavors.length,
      description,
      updatedAt: new Date().toISOString()
    };
  }

  extractFlavors(children) {
    const flavors = [];

    for (const child of children) {
      const customAttributes = child.custom_attributes || [];
      const flavorAttr = customAttributes.find(attr => attr.attribute_code === 'flavor');

      if (flavorAttr && flavorAttr.value) {
        // Value could be the label or an ID - we want the label
        // If it's a number, we'd need to look up the label, but typically it's already the label
        flavors.push(flavorAttr.value);
      }
    }

    // Remove duplicates and sort
    return [...new Set(flavors)].sort();
  }

  buildPrompt(title, flavors) {
    if (flavors.length === 0) {
      return PROMPT_TEMPLATE_NO_FLAVORS.replace('{title}', title);
    }

    const flavorsList = flavors.map(f => `- ${f}`).join('\n');
    return PROMPT_TEMPLATE
      .replace('{title}', title)
      .replace('{flavors}', flavorsList);
  }

  async updateProductDescription(sku, description) {
    const payload = {
      product: {
        sku,
        custom_attributes: [
          {
            attribute_code: 'description',
            value: description
          }
        ]
      }
    };

    try {
      await this.targetService.client.put(
        `/rest/all/V1/products/${encodeURIComponent(sku)}`,
        payload
      );
    } catch (error) {
      throw new DescriptionGenerationError(
        'Failed to update product description',
        'UPDATE_FAILED',
        502,
        { originalError: error.message }
      );
    }
  }
}

module.exports = DescriptionService;
```

**Step 2: Commit**

```bash
git add src/services/description.service.js
git commit -m "feat: add DescriptionService for AI-powered descriptions"
```

---

## Task 5: Create Product Controller

**Files:**
- Create: `src/controllers/product.controller.js`

**Step 1: Create the controller**

```javascript
const logger = require('../config/logger');
const DescriptionService = require('../services/description.service');
const { ValidationError } = require('../utils/error-handler');

const descriptionService = new DescriptionService();

const generateDescription = async (req, res, next) => {
  try {
    const { sku } = req.body;

    if (!sku) {
      throw new ValidationError('SKU is required', [{ field: 'sku', message: 'SKU cannot be empty' }]);
    }

    logger.info('Generate description request received', { sku });

    const result = await descriptionService.generateAndUpdateDescription(sku);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  generateDescription
};
```

**Step 2: Commit**

```bash
git add src/controllers/product.controller.js
git commit -m "feat: add product controller with generateDescription"
```

---

## Task 6: Create Product Routes

**Files:**
- Create: `src/routes/v1/product.routes.js`

**Step 1: Create the routes file**

```javascript
const express = require('express');
const { body } = require('express-validator');
const { validateRequest } = require('../../middleware/validation.middleware');
const asyncHandler = require('../../utils/async-handler');
const { generateDescription } = require('../../controllers/product.controller');

const router = express.Router();

router.post(
  '/generate-description',
  [
    body('sku').notEmpty().withMessage('SKU is required').trim(),
    validateRequest
  ],
  asyncHandler(generateDescription)
);

module.exports = router;
```

**Step 2: Commit**

```bash
git add src/routes/v1/product.routes.js
git commit -m "feat: add product routes with generate-description endpoint"
```

---

## Task 7: Register Product Routes

**Files:**
- Modify: `src/routes/v1/index.js`

**Step 1: Add product routes import and registration**

Update the file to:

```javascript
const express = require('express');
const migrationRoutes = require('./migration.routes');
const healthRoutes = require('./health.routes');
const syncRoutes = require('./sync.routes');
const productRoutes = require('./product.routes');

const router = express.Router();

router.use('/migrate', migrationRoutes);
router.use('/health', healthRoutes);
router.use('/sync', syncRoutes);
router.use('/products', productRoutes);

module.exports = router;
```

**Step 2: Update API overview in routes/index.js**

Modify `src/routes/index.js` to add the new endpoint to the overview:

```javascript
const express = require('express');
const v1Routes = require('./v1');

const router = express.Router();

router.use('/v1', v1Routes);

router.get('/', (req, res) => {
  res.json({
    message: 'Magento Product Migration API',
    version: '1.0.0',
    endpoints: {
      health: '/api/v1/health',
      magentoHealth: '/api/v1/health/magento',
      migrateProduct: 'POST /api/v1/migrate/product',
      migrateBatch: 'POST /api/v1/migrate/products/batch',
      generateDescription: 'POST /api/v1/products/generate-description'
    }
  });
});

module.exports = router;
```

**Step 3: Commit**

```bash
git add src/routes/v1/index.js src/routes/index.js
git commit -m "feat: register product routes in v1 router"
```

---

## Task 8: Install OpenAI Dependency

**Files:**
- Modify: `package.json`

**Step 1: Install the openai package**

```bash
npm install openai
```

**Step 2: Verify installation**

```bash
node -e "require('openai'); console.log('OpenAI SDK loaded')"
```

Expected: "OpenAI SDK loaded"

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add openai dependency"
```

---

## Task 9: Manual Integration Test

**Step 1: Add OPENAI_API_KEY to .env**

Add to your `.env` file:

```
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-4o
```

**Step 2: Start the server**

```bash
npm run dev
```

**Step 3: Test the endpoint**

```bash
curl -X POST http://localhost:3000/api/v1/products/generate-description \
  -H "Content-Type: application/json" \
  -d '{"sku": "YOUR-TEST-SKU"}'
```

Expected: JSON response with success: true and generated description

**Step 4: Verify in Magento Admin**

Check the product in Magento admin to confirm the description was updated.

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add OpenAI config | `src/config/index.js` |
| 2 | Add error class | `src/utils/error-handler.js`, `src/middleware/error.middleware.js` |
| 3 | Create OpenAI client | `src/services/ai/openai.client.js` |
| 4 | Create Description service | `src/services/description.service.js` |
| 5 | Create Product controller | `src/controllers/product.controller.js` |
| 6 | Create Product routes | `src/routes/v1/product.routes.js` |
| 7 | Register routes | `src/routes/v1/index.js`, `src/routes/index.js` |
| 8 | Install dependency | `package.json` |
| 9 | Manual test | - |
