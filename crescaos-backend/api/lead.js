/**
 * LEGACY / NON-PRODUCTION HANDLER
 * Note: Production `/api/webhook` is owned and handled strictly by `CRESCAOS-WEB-BACKEND/server.js` on Railway.
 */
// api/lead.js
const logger = require('../utils/logger');
const { evaluateLead } = require('../utils/scoringModel');

/**
 * Clean endpoint for processing standard incoming leads from frontend 
 * forms, APIs, or custom partners. Validates input and immediately scores the lead.
 */
module.exports = async (req, res) => {
  // CORS Headers allowing the frontend to call this endpoint natively
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method Not Allowed',
      message: 'Only POST requests are allowed.'
    });
  }

  try {
    const { name, email, phone, company, source } = req.body;

    // Reject if missing core identifiers
    if (!email && !phone) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Must provide either an email or a phone number.'
      });
    }

    const leadData = { name, email, phone, company, source };
    
    logger.info('New standard lead ingested.', leadData);

    // Call internal scoring model
    const analysis = evaluateLead(leadData);

    // Provide the combined response
    return res.status(201).json({
      success: true,
      message: 'Lead processed successfully.',
      lead: leadData,
      analysis: analysis
    });

  } catch (err) {
    logger.error('Failed to ingest external lead', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
