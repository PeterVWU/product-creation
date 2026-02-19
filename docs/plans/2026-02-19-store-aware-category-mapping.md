# Store-Aware Category Mapping Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `getShopifyProductType()` return store-specific Shopify product types so VAPORDNA (and future stores) get correct mappings.

**Architecture:** Add per-store overrides to `category-mapping.json` via a `shopifyStores` object. The service builds a nested `Map<storeName, Map<sourceKey, type>>` and checks it before falling back to the default map. The store name is threaded from `options.shopifyStore` through the creation service.

**Tech Stack:** Node.js, existing CategoryMappingService, JSON config

---

### Task 1: Update `category-mapping.json` with VAPORDNA overrides

**Files:**
- Modify: `category-mapping.json`

**Step 1: Update the JSON file**

Add `shopifyStores` with `vapordna` overrides only where the VAPORDNA value differs from the default `shopify` value. Based on the CSV:

| source | shopify (default) | VAPORDNA |
|---|---|---|
| Rebuildables | Rebuildables | Rebuildable |
| Pod System Kits | Pod Systems | Pod Systems |
| Starter Kits & Mods | Starter Kits | Starter Kit |
| Pod Mod Systems | Pod Systems | Pod Systems |
| Box Mod Kits | Starter Kits | Starter Kits |
| Tanks | Atomizers | Vape Tank |
| Replacement Coils | Coils | Coils |
| Replacement Pod Cartridges | Replacement Pods | Replacement Pods |
| E-Liquids | E-Liquid | E-liquid |
| Salt Nicotine | E-Liquid | Nicotine Salt E Liquid |
| 100ml Juices | E-Liquid | E-Liquid |
| Synthetic Nicotine | E-Liquid | E-Liquid |

Entries where VAPORDNA matches default (e.g., Chargers=Chargers) need no override.

```json
{
  "mappings": [
    { "source": "Replacement Glass", "shopify": "Replacement Glass", "targetMagento": "Replacement Glass" },
    { "source": "Chargers", "shopify": "Chargers", "targetMagento": "Chargers" },
    { "source": "Batteries", "shopify": "Batteries", "targetMagento": "Batteries" },
    { "source": "Accessories", "shopify": "Accessories", "targetMagento": "Vaping Accessories" },
    { "source": "Alternatives", "shopify": "Alternatives", "targetMagento": "Alternatives" },
    { "source": "Rebuildables", "shopify": "Rebuildables", "targetMagento": "Rebuildables", "shopifyStores": { "vapordna": "Rebuildable" } },
    { "source": "Pod System Kits", "shopify": "Pod Systems", "targetMagento": "Vape Kits" },
    { "source": "Mods", "shopify": "Mods", "targetMagento": "Mods" },
    { "source": "Starter Kits & Mods", "shopify": "Starter Kits", "targetMagento": "Starter Kits", "shopifyStores": { "vapordna": "Starter Kit" } },
    { "source": "Pod Mod Systems", "shopify": "Pod Systems", "targetMagento": "Vape Kits" },
    { "source": "Box Mod Kits", "shopify": "Starter Kits", "targetMagento": "Starter Kits" },
    { "source": "Tanks", "shopify": "Atomizers", "targetMagento": "Tanks", "shopifyStores": { "vapordna": "Vape Tank" } },
    { "source": "Nicotine Pouches", "shopify": "Nicotine Pouches", "targetMagento": "Nicotine Pouches" },
    { "source": "Nicotine Gum", "shopify": "Nicotine Pouches", "targetMagento": "Nicotine Gum" },
    { "source": "Replacement Coils", "shopify": "Coils", "targetMagento": "Replacement Coils" },
    { "source": "Replacement Pod Cartridges", "shopify": "Replacement Pods", "targetMagento": "Replacement Pods" },
    { "source": "Nic Pouches", "shopify": "Nicotine Pouches", "targetMagento": "Nicotine Pouches" },
    { "source": "Disposables", "shopify": "Disposables", "targetMagento": "Disposables" },
    { "source": "E-Liquids", "shopify": "E-Liquid", "targetMagento": "E-Liquids", "shopifyStores": { "vapordna": "E-liquid" } },
    { "source": "Salt Nicotine", "shopify": "E-Liquid", "targetMagento": "Nic Salts", "shopifyStores": { "vapordna": "Nicotine Salt E Liquid" } },
    { "source": "100ml Juices", "shopify": "E-Liquid", "targetMagento": "100mL E-Juice" },
    { "source": "Synthetic Nicotine", "shopify": "E-Liquid", "targetMagento": "Synthetic Nicotine" },
    { "source": "Herb Grinders", "shopify": "Alternatives", "targetMagento": "Herb Grinders" },
    { "source": "Smoke Shop Supplies", "shopify": "Alternatives", "targetMagento": "Smoke Shop Supplies" },
    { "source": "Glass", "shopify": "Alternatives", "targetMagento": "Glass Pieces" },
    { "source": "Alt Vape Accessories", "shopify": "Alternatives", "targetMagento": "Alt Vaporizers & Accessories" },
    { "source": "Cotton", "shopify": "Accessories", "targetMagento": "Cotton" },
    { "source": "Drip Tips", "shopify": "Accessories", "targetMagento": "Drip Tips" }
  ]
}
```

**Step 2: Commit**

```bash
git add category-mapping.json
git commit -m "feat: add VAPORDNA store overrides to category mapping JSON"
```

---

### Task 2: Update `CategoryMappingService` to support store-specific lookups

**Files:**
- Modify: `src/services/category-mapping.service.js`

**Step 1: Add `sourceToShopifyByStore` map in constructor**

In `src/services/category-mapping.service.js:8`, add after `this.sourceToTargetMagento`:

```js
this.sourceToShopifyByStore = new Map(); // Map<storeName, Map<sourceKey, shopifyType>>
```

**Step 2: Populate store-specific maps in `loadMappings()`**

In `src/services/category-mapping.service.js:32-42`, after the existing loop body that populates `sourceToShopify` and `sourceToTargetMagento`, add inside the same `for` loop:

```js
        // Build per-store Shopify mappings
        if (mapping.shopifyStores) {
          for (const [storeName, storeType] of Object.entries(mapping.shopifyStores)) {
            const storeKey = storeName.toLowerCase();
            if (!this.sourceToShopifyByStore.has(storeKey)) {
              this.sourceToShopifyByStore.set(storeKey, new Map());
            }
            this.sourceToShopifyByStore.get(storeKey).set(sourceKey, storeType);
          }
        }
```

Update the log line at line 46-50 to include store count:

```js
      logger.info('Category mappings loaded', {
        mappingCount: this.mappings.length,
        shopifyMappings: this.sourceToShopify.size,
        magentoMappings: this.sourceToTargetMagento.size,
        storeSpecificMappings: this.sourceToShopifyByStore.size
      });
```

**Step 3: Update `getShopifyProductType` signature and logic**

Replace the method at `src/services/category-mapping.service.js:66-87` with:

```js
  getShopifyProductType(sourceCategoryNames, storeName = null) {
    this.loadMappings();

    if (!sourceCategoryNames || sourceCategoryNames.length === 0) {
      return null;
    }

    // Check store-specific map first if storeName is provided
    const storeMap = storeName ? this.sourceToShopifyByStore.get(storeName.toLowerCase()) : null;

    for (const categoryName of sourceCategoryNames) {
      const key = categoryName.toLowerCase();

      // Try store-specific mapping first
      if (storeMap && storeMap.has(key)) {
        const shopifyType = storeMap.get(key);
        logger.debug('Found store-specific Shopify product type mapping', {
          sourceCategory: categoryName,
          storeName,
          shopifyType
        });
        return shopifyType;
      }

      // Fall back to default mapping
      if (this.sourceToShopify.has(key)) {
        const shopifyType = this.sourceToShopify.get(key);
        logger.debug('Found Shopify product type mapping', {
          sourceCategory: categoryName,
          shopifyType
        });
        return shopifyType;
      }
    }

    logger.debug('No Shopify product type mapping found', { sourceCategoryNames, storeName });
    return null;
  }
```

**Step 4: Commit**

```bash
git add src/services/category-mapping.service.js
git commit -m "feat: add store-aware lookups to CategoryMappingService"
```

---

### Task 3: Thread `storeName` through `ShopifyCreationService`

**Files:**
- Modify: `src/services/migration/shopify-creation.service.js:6-10` (constructor)
- Modify: `src/services/migration/shopify-creation.service.js:37` (createProducts call to buildShopifyProduct)
- Modify: `src/services/migration/shopify-creation.service.js:299` (buildShopifyProduct signature)
- Modify: `src/services/migration/shopify-creation.service.js:316-317` (getShopifyProductType call)
- Modify: `src/services/migration/shopify-orchestrator.service.js:96` (construction)
- Modify: `src/services/migration/shopify-orchestrator.service.js:282` (construction in executeCreationPhase)

**Step 1: Add `storeName` to `ShopifyCreationService` constructor**

At `shopify-creation.service.js:5-10`, change constructor to accept and store `storeName`:

```js
  constructor(sourceService, shopifyTargetService, categoryMappingService = null, storeName = null) {
    this.sourceService = sourceService;
    this.shopifyTargetService = shopifyTargetService;
    this.categoryMappingService = categoryMappingService;
    this.storeName = storeName;
  }
```

**Step 2: Pass `storeName` to `getShopifyProductType` in `buildShopifyProduct`**

At `shopify-creation.service.js:317`, change:

```js
      productType = this.categoryMappingService.getShopifyProductType(sourceCategoryNames);
```

to:

```js
      productType = this.categoryMappingService.getShopifyProductType(sourceCategoryNames, this.storeName);
```

**Step 3: Pass `storeName` when constructing `ShopifyCreationService` in orchestrator**

At `shopify-orchestrator.service.js:96`, change:

```js
      const creationService = new ShopifyCreationService(this.sourceService, shopifyTargetService, this.categoryMappingService);
```

to:

```js
      const creationService = new ShopifyCreationService(this.sourceService, shopifyTargetService, this.categoryMappingService, options.shopifyStore);
```

At `shopify-orchestrator.service.js:282`, change:

```js
      const creationService = new ShopifyCreationService(this.sourceService, shopifyTargetService, this.categoryMappingService);
```

to:

```js
      const creationService = new ShopifyCreationService(this.sourceService, shopifyTargetService, this.categoryMappingService, options.shopifyStore);
```

**Step 4: Commit**

```bash
git add src/services/migration/shopify-creation.service.js src/services/migration/shopify-orchestrator.service.js
git commit -m "feat: thread storeName through ShopifyCreationService for store-aware category mapping"
```

---

### Task 4: Manual verification

**Step 1: Verify JSON is valid**

```bash
node -e "const d = require('./category-mapping.json'); console.log('Mappings:', d.mappings.length); const withStores = d.mappings.filter(m => m.shopifyStores); console.log('With store overrides:', withStores.length); withStores.forEach(m => console.log(' ', m.source, '->', JSON.stringify(m.shopifyStores)));"
```

Expected:
```
Mappings: 28
With store overrides: 4
  Rebuildables -> {"vapordna":"Rebuildable"}
  Starter Kits & Mods -> {"vapordna":"Starter Kit"}
  Tanks -> {"vapordna":"Vape Tank"}
  E-Liquids -> {"vapordna":"E-liquid"}
  Salt Nicotine -> {"vapordna":"Nicotine Salt E Liquid"}
```

**Step 2: Verify service loads correctly**

```bash
node -e "
const CategoryMappingService = require('./src/services/category-mapping.service');
const svc = new CategoryMappingService();
svc.loadMappings();

// Default behavior unchanged
console.log('Default Tanks:', svc.getShopifyProductType(['Tanks']));
console.log('Default E-Liquids:', svc.getShopifyProductType(['E-Liquids']));

// Store-specific
console.log('VAPORDNA Tanks:', svc.getShopifyProductType(['Tanks'], 'vapordna'));
console.log('VAPORDNA E-Liquids:', svc.getShopifyProductType(['E-Liquids'], 'vapordna'));

// No override falls through to default
console.log('VAPORDNA Chargers:', svc.getShopifyProductType(['Chargers'], 'vapordna'));

// Unknown store falls through to default
console.log('Unknown Tanks:', svc.getShopifyProductType(['Tanks'], 'unknownstore'));
"
```

Expected:
```
Default Tanks: Atomizers
Default E-Liquids: E-Liquid
VAPORDNA Tanks: Vape Tank
VAPORDNA E-Liquids: E-liquid
VAPORDNA Chargers: Chargers
Unknown Tanks: Atomizers
```
