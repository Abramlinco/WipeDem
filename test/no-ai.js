// Imported first by tests that draft replies. ES modules run imports in order,
// so this sets the variable before config.js reads it. A .env file cannot override it
// because dotenv never replaces a variable that is already set.
process.env.AI_PROVIDER = 'none';
