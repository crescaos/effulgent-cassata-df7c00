/**
 * LEGACY / NON-PRODUCTION HANDLER
 * Note: Production `/api/webhook` is owned and handled strictly by `CRESCAOS-WEB-BACKEND/server.js` on Railway.
 * This Netlify handler is preserved for reference only.
 */
const ghl = require('../utils/ghl');
const logger = require('../utils/logger');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

/**
 * Handles incoming leads from the "Book Audit" form.
 * Syncs the data directly to GoHighLevel (GHL).
 */
exports.handler = async (event, context) => {
  // CORS Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let payload;
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch (parseError) {
    logger.error('Failed to parse event body', parseError);
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  try {
    logger.info('Incoming Audit Form Submission', { payload });

    // 1. Map Form Payload to GHL Contact Data
    const isESLead = payload.source === 'El Salvador Intake Form';
    const isAuditWizard = payload.source === 'Growth Audit Wizard' || payload.source === 'Growth Audit Wizard (ES)';
    const isDiagnostic = payload.source === 'Diagnostic Funnel';
    const isLeadMagnet = payload.offer === 'revenue-leak-checklist' || payload.source === 'Lead Magnet - Revenue Leak Checklist';
    
    // Normalize names from the wizard (full_name) vs the form (firstName/lastName) vs Diagnostic (name)
    let firstName = payload.firstName || '';
    let lastName = payload.lastName || '';
    if (payload.full_name) {
      const parts = payload.full_name.trim().split(' ');
      firstName = parts[0];
      lastName = parts.slice(1).join(' ');
    } else if (payload.name) {
      const parts = payload.name.trim().split(' ');
      firstName = parts[0];
      lastName = parts.slice(1).join(' ');
    }

    const tags = [];
    if (isLeadMagnet) {
      // Tag drives the GHL delivery + nurture workflow
      tags.push('lead-magnet-revenue-leak-checklist', payload.language === 'es' ? 'cresca:lang_es' : 'cresca:lang_en');
    }
    else if (isESLead) tags.push('es-lead');
    else if (isDiagnostic) {
      tags.push('cresca:diagnostic_completed', payload.language === 'es' ? 'cresca:lang_es' : 'cresca:lang_en');
      if (payload.service) tags.push(`cresca:service_${payload.service}`);
    }
    else tags.push('growth-audit');

    const contactData = {
      firstName: firstName || 'Audit',
      lastName: lastName || 'Lead',
      tags: tags,
      source: payload.utm_source || payload.source || 'Diagnostic Funnel',
      customFields: []
    };
    
    if (payload.email) contactData.email = payload.email.toLowerCase();
    if (payload.phone) contactData.phone = payload.phone;
    if (payload.company || payload.business_name || payload.businessName) contactData.companyName = payload.company || payload.business_name || payload.businessName;

    // 2. Format detailed note for ES Leads or standard Audit Leads
    let noteContent = `Source: ${payload.source || 'Website Form'}\n`;

    if (isLeadMagnet) {
      noteContent += `--- Lead Magnet ---\n`;
      noteContent += `Offer: 10-Point Revenue Leak Checklist\n`;
      noteContent += `Language: ${payload.language || 'en'}\n`;
      const lmTrack = [];
      if (payload.utm_source) lmTrack.push(`UTM Source: ${payload.utm_source}`);
      if (payload.utm_medium) lmTrack.push(`UTM Medium: ${payload.utm_medium}`);
      if (payload.utm_campaign) lmTrack.push(`UTM Campaign: ${payload.utm_campaign}`);
      if (payload.source_page) lmTrack.push(`Source Page: ${payload.source_page}`);
      if (payload.referrer) lmTrack.push(`Referrer: ${payload.referrer}`);
      if (payload.landing_page) lmTrack.push(`Landing Page: ${payload.landing_page}`);
      if (lmTrack.length > 0) noteContent += `\n--- Tracking Attribution ---\n` + lmTrack.join('\n') + `\n`;
    } else if (isAuditWizard) {
      if (payload.website) contactData.customFields.push({ key: 'website', value: payload.website });
      
      // Map to custom fields from environment
      if (payload.monthly_leads) contactData.customFields.push({ id: process.env.GHL_FIELD_MONTHLY_LEADS, value: payload.monthly_leads });
      if (payload.response_time) contactData.customFields.push({ id: process.env.GHL_FIELD_RESPONSE_TIME, value: payload.response_time });
      if (payload.followup_freq) contactData.customFields.push({ id: process.env.GHL_FIELD_FOLLOWUP_FREQ, value: payload.followup_freq });
      if (payload.booking_system) contactData.customFields.push({ id: process.env.GHL_FIELD_BOOKING_SYSTEM, value: payload.booking_system });
      if (payload.missed_calls) contactData.customFields.push({ id: process.env.GHL_FIELD_MISSED_CALLS, value: payload.missed_calls });
      if (payload.loss_percentage) contactData.customFields.push({ id: process.env.GHL_FIELD_LOSS_PERCENT, value: payload.loss_percentage });
      if (payload.lost_revenue) contactData.customFields.push({ id: process.env.GHL_FIELD_LOST_REVENUE, value: payload.lost_revenue });
      
      // Optional Advanced Fields
      if (payload.website) contactData.customFields.push({ id: process.env.GHL_FIELD_WEBSITE, value: payload.website });
      if (payload.ad_spend) contactData.customFields.push({ id: process.env.GHL_FIELD_AD_SPEND, value: payload.ad_spend });

      noteContent += `--- Growth Audit Results ---\n`;
      if (payload.loss_percentage) noteContent += `Total Interaction Loss: ${payload.loss_percentage}%\n`;
      if (payload.lost_revenue) noteContent += `Monthly Revenue Opportunity: $${payload.lost_revenue.toLocaleString()}\n`;
      
      if (payload.ad_spend) {
        const adWaste = (parseFloat(payload.ad_spend) * (parseFloat(payload.loss_percentage) / 100)) || 0;
        noteContent += `--- Marketing ROI Snapshot ---\n`;
        noteContent += `Avg Monthly Ad Spend: $${payload.ad_spend}\n`;
        noteContent += `Estimated Wasted Ad Spend: $${adWaste.toFixed(2)}/mo\n`;
      }

      noteContent += `\n--- Operational Profile ---\n`;
      if (payload.monthly_leads) noteContent += `Monthly Leads: ${payload.monthly_leads}\n`;
      if (payload.missed_calls) noteContent += `Missed Calls/Week: ${payload.missed_calls}\n`;
      if (payload.response_time) noteContent += `Avg Response Time: ${payload.response_time}\n`;
      if (payload.has_booking) noteContent += `Has Booking System: ${payload.has_booking}\n`;
      if (payload.website) noteContent += `Website: ${payload.website}\n`;
      
    } else if (isESLead) {
      if (payload.plan) noteContent += `Selected Plan: ${payload.plan.toUpperCase()}\n`;
      noteContent += `Role: ${payload.role || 'N/A'}\n`;
      noteContent += `Employees: ${payload.employees || 'N/A'}\n`;
      if (payload.revenue) noteContent += `Annual Revenue: ${payload.revenue}\n`;
      if (payload.website) noteContent += `Website: ${payload.website}\n`;
      if (payload.needs) noteContent += `Biggest Needs: ${payload.needs}\n`;
    } else if (isDiagnostic) {
      noteContent += `--- Diagnostic Funnel Results ---\n`;
      if (payload.service) noteContent += `Service Interest: ${payload.service}\n`;
      if (payload.score) noteContent += `Score: ${payload.score} / 100 (${payload.score_tier || 'N/A'})\n`;
      if (payload.monthlyLoss) noteContent += `Monthly Revenue Loss: $${payload.monthlyLoss.toLocaleString()}\n`;
      if (payload.businessType) noteContent += `Business Type: ${payload.businessType}\n`;
      if (payload.revenue) noteContent += `Revenue Stage: ${payload.revenue}\n`;
      if (payload.bottleneck) noteContent += `Bottleneck: ${payload.bottleneck}\n`;
      if (payload.responseTime) noteContent += `Response Time: ${payload.responseTime}\n`;

      const track = [];
      if (payload.utm_source) track.push(`UTM Source: ${payload.utm_source}`);
      if (payload.utm_medium) track.push(`UTM Medium: ${payload.utm_medium}`);
      if (payload.utm_campaign) track.push(`UTM Campaign: ${payload.utm_campaign}`);
      if (payload.utm_content) track.push(`UTM Content: ${payload.utm_content}`);
      if (payload.utm_term) track.push(`UTM Term: ${payload.utm_term}`);
      if (payload.source_page) track.push(`Source Page: ${payload.source_page}`);
      if (payload.referrer) track.push(`Referrer: ${payload.referrer}`);
      if (payload.landing_page) track.push(`Landing Page: ${payload.landing_page}`);
      
      if (track.length > 0) {
        noteContent += `\n--- Tracking Attribution ---\n` + track.join('\n') + `\n`;
      }
    } else {
      if (payload.website) contactData.customFields.push({ key: 'website', value: payload.website });
      if (payload.bottleneck) noteContent += `Bottleneck: ${payload.bottleneck}\n`;
      if (payload.leads_monthly) noteContent += `Monthly Leads: ${payload.leads_monthly}\n`;
    }
    
    // 3. Upsert Contact in GHL
    if (contactData.email) {
      const ghlContact = await ghl.upsertContact(contactData);
      const contactId = ghlContact.id || (ghlContact.contact && ghlContact.contact.id);

      // 3b. Create Note on the contact (GHL API v2 requires a separate /notes call)
      if (contactId && noteContent) {
        try {
          await ghl.request('POST', `/contacts/${contactId}/notes`, {
            userId: '',
            body: noteContent
          });
          logger.info('Note added to GHL contact', { contactId });
        } catch (noteErr) {
          logger.warn('Note creation failed (non-critical)', noteErr.message);
        }
      }

      // 4. Create Opportunity in the Sales Pipeline
      // Ensure GHL_PIPELINE_ID and GHL_STAGE_ID are set in environment
      const pipelineId = process.env.GHL_PIPELINE_ID;
      const stageId = process.env.GHL_STAGE_ID;
      
      if (!pipelineId || !stageId) {
         logger.warn('Missing GHL_PIPELINE_ID or GHL_STAGE_ID env variables, skipping opportunity creation');
      }

      logger.info('Attempting opportunity creation', { contactId, pipelineId, stageId });

      // Lead magnets stay top-of-funnel: no opportunity in the sales pipeline
      // until they book (the GHL nurture workflow handles that transition).
      if (contactId && pipelineId && !isLeadMagnet) {
        try {
          const oppTitle = `${isESLead ? 'ES' : (isAuditWizard ? 'AUDIT' : 'LEAD')}: ${payload.company || payload.full_name || payload.firstName}`;
          const oppValue = isAuditWizard ? (payload.lost_revenue || 0) : 0;
          const opp = await ghl.createOpportunity(contactId, pipelineId, stageId, oppTitle, oppValue);
          logger.info('Opportunity created in GHL', { contactId, pipelineId, stageId, oppId: opp && (opp.id || (opp.opportunity && opp.opportunity.id)) });
        } catch (oppErr) {
          logger.error('Opportunity creation failed', { contactId, pipelineId, stageId, error: oppErr.response ? JSON.stringify(oppErr.response.data) : oppErr.message });
        }
      } else {
        logger.warn('Skipped opportunity — missing contactId or pipelineId', { contactId, pipelineId });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Lead received and synced to GHL.'
      })
    };

  } catch (err) {
    logger.error('Failed to sync Audit Lead to GHL', err);
    // return 200 to prevent form errors on the frontend, but log the failure
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, warning: 'Synced with delay' })
    };
  }
};
