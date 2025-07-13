const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Simple Teable client
class Teable {
  constructor() {
    this.baseUrl = process.env.TEABLE_URL || 'http://localhost:3000';
    this.token = process.env.TEABLE_API_TOKEN;
    this.baseId = process.env.TEABLE_BASE_ID;
  }

  async request(endpoint, method = 'GET', data = null) {
    const response = await axios({
      method,
      url: `${this.baseUrl}/api${endpoint}`,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      data
    });
    return response.data;
  }

  async getTableId(tableName) {
    const tables = await this.request(`/base/${this.baseId}/table`);
    const table = tables.find(t => t.name === tableName);
    return table?.id;
  }

  async createRecord(tableName, data) {
    const tableId = await this.getTableId(tableName);
    return this.request(`/table/${tableId}/record`, 'POST', {
      records: [{ fields: data }]
    });
  }

  async getRecord(tableName, filter) {
    const tableId = await this.getTableId(tableName);
    const params = new URLSearchParams(filter);
    const result = await this.request(`/table/${tableId}/record?${params}`);
    return result.records?.[0];
  }

  async updateRecord(tableName, recordId, data) {
    const tableId = await this.getTableId(tableName);
    return this.request(`/table/${tableId}/record/${recordId}`, 'PATCH', {
      fields: data
    });
  }
}

const teable = new Teable();

// Generate survey token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Load HTML template
function loadTemplate(name, data = {}) {
  const template = fs.readFileSync(path.join(__dirname, 'views', `${name}.html`), 'utf8');
  return template.replace(/{{(\w+)}}/g, (match, key) => data[key] || '');
}

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Survey page
app.get('/survey/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    // Get survey response record
    const surveyResponse = await teable.getRecord('survey_responses', {
      'filter[token]': token
    });

    if (!surveyResponse) {
      return res.status(404).send('Survey not found or expired');
    }

    if (surveyResponse.fields.status === 'completed') {
      return res.send(loadTemplate('success', {
        message: 'Thank you! You have already completed this survey.'
      }));
    }

    // Get survey questions
    const survey = await teable.getRecord('surveys', {
      'filter[id]': surveyResponse.fields.survey_id
    });

    const questions = JSON.parse(survey.fields.questions || '[]');
    
    // Build questions HTML
    const questionsHtml = questions.map(q => {
      if (q.type === 'rating') {
        const buttons = Array.from({length: q.scale}, (_, i) => {
          const value = i + 1;
          return `<button type="button" class="rating-btn" data-question="${q.id}" data-value="${value}">${value}</button>`;
        }).join('');
        return `
          <div class="question">
            <label>${q.question} ${q.required ? '*' : ''}</label>
            <div class="rating-group" data-question="${q.id}">
              ${buttons}
            </div>
            <input type="hidden" name="${q.id}" required="${q.required}">
          </div>
        `;
      } else if (q.type === 'text') {
        return `
          <div class="question">
            <label>${q.question} ${q.required ? '*' : ''}</label>
            <textarea name="${q.id}" ${q.required ? 'required' : ''}></textarea>
          </div>
        `;
      }
    }).join('');

    res.send(loadTemplate('survey', {
      title: survey.fields.title,
      description: survey.fields.description || '',
      questions: questionsHtml,
      token
    }));

  } catch (error) {
    console.error('Survey error:', error);
    res.status(500).send('Error loading survey');
  }
});

// Submit survey
app.post('/survey/:token/submit', async (req, res) => {
  try {
    const { token } = req.params;
    const responses = req.body;

    // Get survey response record
    const surveyResponse = await teable.getRecord('survey_responses', {
      'filter[token]': token
    });

    if (!surveyResponse || surveyResponse.fields.status === 'completed') {
      return res.status(400).json({ error: 'Survey not found or already completed' });
    }

    // Calculate overall rating (average of rating questions)
    const ratingValues = Object.entries(responses)
      .filter(([key, value]) => !isNaN(value))
      .map(([key, value]) => parseInt(value));
    
    const overallRating = ratingValues.length > 0 
      ? Math.round(ratingValues.reduce((a, b) => a + b, 0) / ratingValues.length)
      : null;

    // Update survey response
    await teable.updateRecord('survey_responses', surveyResponse.id, {
      status: 'completed',
      responses: JSON.stringify(responses),
      overall_rating: overallRating,
      comments: responses.additional_comments || '',
      submitted_at: new Date().toISOString()
    });

    // Optional: Update SyncroMSP if configured
    if (process.env.SYNCRO_API_KEY && surveyResponse.fields.ticket_id) {
      try {
        const ticket = await teable.getRecord('tickets', {
          'filter[id]': surveyResponse.fields.ticket_id
        });
        
        if (ticket?.fields.external_id) {
          await updateSyncroTicket(ticket.fields.external_id, {
            csat_score: overallRating,
            csat_comments: responses.additional_comments || '',
            csat_response_date: new Date().toISOString().split('T')[0]
          });
        }
      } catch (syncroError) {
        console.error('SyncroMSP update failed:', syncroError);
        // Don't fail the survey submission if Syncro update fails
      }
    }

    res.json({ success: true });

  } catch (error) {
    console.error('Submit error:', error);
    res.status(500).json({ error: 'Failed to submit survey' });
  }
});

// SyncroMSP webhook
app.post('/webhook/syncro', async (req, res) => {
  try {
    const { event, data } = req.body;

    if (event === 'ticket.closed' && data.customer?.email) {
      // Create survey for closed ticket
      const token = generateToken();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + parseInt(process.env.SURVEY_EXPIRY_DAYS || '30'));

      // Create ticket record
      const ticket = await teable.createRecord('tickets', {
        external_id: data.id.toString(),
        ticketing_system: 'syncro',
        customer_email: data.customer.email,
        customer_name: data.customer.name || '',
        subject: data.subject || '',
        status: 'closed',
        closed_at: new Date().toISOString()
      });

      // Get default survey
      const survey = await teable.getRecord('surveys', {
        'filter[is_active]': true
      });

      if (survey) {
        // Create survey response
        await teable.createRecord('survey_responses', {
          survey_id: survey.id,
          ticket_id: ticket.records[0].id,
          token,
          status: 'pending',
          expires_at: expiresAt.toISOString()
        });

        // Here you would send email with survey link
        const surveyLink = `${process.env.PUBLIC_ORIGIN}/survey/${token}`;
        console.log(`Survey created for ticket ${data.id}: ${surveyLink}`);
        
        // TODO: Send email using your preferred method
        // await sendSurveyEmail(data.customer.email, surveyLink, data);
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// SyncroMSP API helper
async function updateSyncroTicket(ticketId, customFields) {
  if (!process.env.SYNCRO_API_KEY) return;

  await axios.put(
    `https://${process.env.SYNCRO_SUBDOMAIN}.syncromsp.com/api/v1/tickets/${ticketId}`,
    { custom_fields: customFields },
    {
      headers: {
        'Authorization': `Bearer ${process.env.SYNCRO_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`OpenCSAT server running on port ${PORT}`);
});
