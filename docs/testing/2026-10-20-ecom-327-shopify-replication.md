# ECOM-327 verification — 2026-10-20

[Ticket](https://linear.app/vapewholesale-internal/issue/ECOM-327/support-product-migration-and-updates-from-vapordna-to-other-shopify)

## Environment and isolation

- Local Node application with an isolated PostgreSQL 17 cluster on port 55432.
- Automated-test database: `ecom327_test`; live-verification database: `ecom327`.
- Source: `vapordna9686.myshopify.com` (VaporDNA). Source requests were read-only, enforced by the live harness; source product snapshots were compared before and after testing.
- Sole Shopify write destination: `vwu-test-store.myshopify.com` (`test` alias). The harness verifies the actual destination identity before writing.
- Live HTTP requests used a temporary operator API key. The key was deleted afterward. Google Chat and Slack notifications were disabled during live verification.
- Local source credentials were corrected in the ignored `.env`; credentials are not included in this change.

## Automated checks

```bash
DB_HOST=/tmp DB_PORT=55432 DB_USER=vwu \
  DB_NAME=ecom327_test DB_NAME_TEST=ecom327_test \
  LOG_LEVEL=error GOOGLE_CHAT_ENABLED=false SLACK_ENABLED=false \
  npm test -- --runInBand --detectOpenHandles
```

Result: **27 suites, 288 tests passed**, with a clean process exit and no open-handle warning.

New tests cover paginated variant/media extraction and strict paginated SKU lookup; exact-host description replacement; new creation and SKU adoption; source SKU changes via stored variant IDs and restoration of missing destination variants; conflicting matches; same-shop rejection; explicit status and source-handle preservation; sparse option combinations; disabled image updates; additive images for missing variants; obsolete variant-media detachment; price-only updates and compare-at clearing; destination-only variant preservation; bounded bulk updates; explicit standalone-variant preservation; partial-failure and publication retries; HTTP authentication, permissions, validation, useful 400/404 errors, routing and audit records; concurrent mapping serialization and unique destination ownership.

Existing tests were refreshed to reflect existing production behavior: the fourth seeded role, current Magento create/update method names and global content scope, the notification module, and Shopify's default Title option. Legacy orchestrator tests now mock database prompt lookup and external dependencies, removing accidental database/OpenAI coupling. These test updates do not change the existing Magento flow.

New JavaScript files were checked with Node syntax checks and targeted ESLint checks (`no-unused-vars`, `no-undef`, `no-unreachable`, and `valid-typeof`). Ticket-file whitespace checks passed. Unrelated pre-existing worktree edits were excluded.

## Live HTTP verification

```bash
DB_HOST=/tmp DB_PORT=55432 DB_USER=vwu DB_NAME=ecom327 LOG_LEVEL=error \
  node scripts/test-shopify-replication.js --inject-failure \
  gid://shopify/Product/7946442735675 \
  gid://shopify/Product/8022795124795 \
  gid://shopify/Product/8044453494843 \
  gid://shopify/Product/7706188316731

DB_HOST=/tmp DB_PORT=55432 DB_USER=vwu DB_NAME=ecom327 LOG_LEVEL=error \
  node scripts/test-shopify-replication.js --partial-destination \
  gid://shopify/Product/7699766673467
```

Result: **passed**. Five products exercised single-variant, multi-variant, image-bearing, and variant-specific-image listings. The final case started with one of ten variants and added the remaining nine with their images, retaining its original variant and images. Initial creation copied one image for the Pixy listing and three images for the Air Factory listing.

| VaporDNA product | Test destination product |
|---|---|
| `7946442735675` — It's Pixy Salt Nic - Sour Apple - 30ml | [`8918782214279`](https://admin.shopify.com/store/vwu-test-store/products/8918782214279) |
| `8022795124795` — Gold Leaf E-Liquid - Royal Oak - 100mL | [`8918756098183`](https://admin.shopify.com/store/vwu-test-store/products/8918756098183) |
| `8044453494843` — VOOPOO PNP-X Pod Tank | [`8918756229255`](https://admin.shopify.com/store/vwu-test-store/products/8918756229255) |
| `7706188316731` — Air Factory Salt Nic - Blue Razz - 30ml | [`8918757933191`](https://admin.shopify.com/store/vwu-test-store/products/8918757933191) |
| `7699766673467` — IceFog 40K Switch Pro Disposable Vape Full Kit | [`8918792765575`](https://admin.shopify.com/store/vwu-test-store/products/8918792765575) |

Verified through the local HTTP endpoints and Shopify reads:

- An injected interruption after shell/image creation returned HTTP 207. The retry reused the same product and added its missing variant rather than duplicating the listing.
- Destination-only edits to title, SKU, price and compare-at price were made on the test clones. Content updates restored approved title, description, vendor, product type, tags, SEO, mapped SKUs and images while retaining the temporary destination price.
- Description HTML matched the source with the destination public domain substituted. Variant-image associations matched the stored source-to-destination image mapping.
- Price sync restored source prices and compare-at values, including null values.
- Inventory quantities, tracking and product status remained unchanged across content updates.
- Repeated create requests reused the product ID and created zero additional source variants.
- An extra destination-only variant retained its ID and price across create, content and price operations. Existing variants were never removed.
- Mixed successful/invalid destinations returned HTTP 207 with independent results. Selecting VaporDNA as its own destination was rejected before any mutation.
- Audit records existed for create, content and price operations; source snapshots remained unchanged.

The test clones and destination-only test variants remain as drafts for inspection. Temporary destination edits were restored from the source. Automated tests supply the remaining destructive-edge and conflict coverage without creating production fixtures (ambiguous matches, missing mappings, multi-page extraction and batches over 250 variants).

## Implementation safeguards and Shopify references

Variant updates use bulk create/update operations rather than replacing a product's variant list. Creation explicitly uses [`PRESERVE_STANDALONE_VARIANT`](https://shopify.dev/docs/api/admin-graphql/2026-07/enums/ProductVariantsBulkCreateStrategy), because Shopify's default strategy can remove the only default variant.

Product image refresh uses [`productSet`](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/productSet) with only its file list; it never supplies a replacement variant list, collections, or metafields. Variant image changes use [media detachment](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/productVariantDetachMedia) and [bulk variant updates](https://shopify.dev/docs/api/admin-graphql/2026-07/input-objects/ProductVariantsBulkInput).

## Follow-up: destination branding in descriptions

Product description text and accessible labels now replace case-insensitive VaporDNA / Vapor DNA references with the destination's Shopify shop name. SEO meta descriptions receive the same replacement as plain text. Source-host links and bare storefront references use the destination domain; URL paths, query values, unrelated domains and email addresses remain intact. HTML output escapes special characters in the destination name. SEO titles retain their existing behavior.

Validation: **27 suites, 292 tests passed**, including create/content-update branding, HTML escaping, accessible labels, meta-description text, and URL/email preservation. Targeted lint and whitespace checks passed.

The local API was restarted on port 3000. A content-update request for the existing Pixy test clone (`8918782214279`) was read back from Shopify: its description used `vwu-test-store`, and its meta description ended with `Shop vwu-test-store today.` Prices, status, images and the source listing were unchanged. Existing listings receive this correction through the content-update endpoint; repeating a create request keeps its established add-missing-variants behavior.
