Phase 1: Source Extraction (Get Data)

Get Parent Data: Fetch the Configurable Product by SKU.

Get Child Data: Fetch all linked Simple Products.

Translate IDs to Names:

Query Source API to find the Names for the Attribute Set (e.g., "T-Shirt").
Query Source API to find the Labels for Attribute  (e.g., ID 92 = "flavor").
Query Source API to find the Labels for Attribute Values (e.g., ID 92 = "Blue").
Query Source API to find the Category (e.g., "Disposables").
Query Source API to find the Brand (e.g., "7DAZE").
Query Source API to find the Manufacturer (e.g., "Aspire").

Phase 2: Target Preparation (Get IDs)
Find/Create Attribute Values: * Search Target API for "Blue". * Correction: If "Blue" does not exist, you must POST to create it and get the new ID, if found use the id.
same for other feilds above

Phase 3: Creation (Write Data) 6. Create Simple Products: * POST each child product using the new Attribute Set ID and new Attribute Value IDs (e.g., "Blue" = 154). * Images: Download from Source, Base64 encode, and POST to the new Simple Product immediately. 7. Create Parent Shell: * POST the Configurable Product (Status: Enabled, Visibility: Catalog/Search) with the new Attribute Set ID. * Images: Upload the main marketing image to this parent product. 8. Define Options (The Missing Step): * POST to /products/{sku}/options on the Parent. * Action: Tell the parent, "You vary by Color (ID 93) and Size (ID 140), and the allowed values are Blue, Red, S, M." 9. Link Children: * POST to /products/{sku}/child to connect the Simple Products to the Parent.

source magento url: https://staging.vapewholesaleusa.com
source magento token: 8s39ggaa347bjkuctutpzgjn19kbkqw8
target magento url: https://h79xmxgomfk7jkn.ejuices.com
target magento toekn: 4z46rgyzcvh21xxzg3x200mm61e66bau

testing SKU: TEST-ABC