// Load env vars for test database connection
require('dotenv').config();

// Use a separate test database to avoid polluting development data
process.env.DB_NAME = process.env.DB_NAME_TEST || process.env.DB_NAME || 'migration_api_test';
