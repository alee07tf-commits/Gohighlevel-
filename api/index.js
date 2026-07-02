// Vercel serverless entrypoint — wraps the Express app.
// All routes (API, public funnel/booking pages and the SPA) are rewritten
// here via vercel.json.
module.exports = require('../server/index');
