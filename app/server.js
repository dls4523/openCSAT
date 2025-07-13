const express = require('express');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Simple Teable client using Node's built-in http
class Teable {
  constructor() {
    this.baseUrl = process.env.TEABLE_URL || 'http://localhost:3000';
    this.token = process.env.TEABLE_API_TOKEN;
    this.baseId = process.env.TEABLE_BASE_ID;
  }

  async request(endpoint, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.baseUrl}/api${endpoint}`);
      
      const options = {
        hostname: url.hostname,
        port: url.port || 3000,
        path: url.pathname + url.search,
        method: method,
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        }
      };

      if (method !== 'GET' && data !== null) {
        const jsonData = JSON.stringify(data);
        options.headers['Content-Length'] = Buffer.byteLength(jsonData);
      }

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const result = body ? JSON.parse(body) : {};
              resolve(result);
            } else {
              console.error(`Teable API Error: ${res.statusCode} ${body}`);
              reject(new Error(`HTTP ${res.statusCode}: ${body}`));
            }
          } catch (e) {
            console.error(`Parse error: ${e.message}, Body: ${body}`);
            reject(new Error(`Parse error: ${e.message}`));
          }
        });
      });

      req.on('error', (error) => {
        console.error(`Request error: ${error.message}`);
        reject(error);
      });

      if (method !== 'GET' && data !== null) {
        req.write(JSON.stringify(data));
      }

      req.end();
    });
  }

  async getTableId(tableName) {
    try {
      const tables = await this.request(`/base/${this.baseId}/table`);
      const table = tables.find(t => t.name === tableName);
      return table?.id;
    } catch (error) {
      console.error(`Error getting table ID for ${tableName}:`, error.message);
      throw error;
    }
  }

  async createRecord(tableName, data) {
    const tableId = await this.getTableId(tableName);
    return this.request(`/table/${tableId}/record`, 'POST', {
      records: [{ fields: data }]
    });
  }

  async getRecords(tableName, options = {}) {
    const tableId = await this.getTableId(tableName);
    const params = new URLSearchParams();
    
    if (options.filterByFormula) {
      params.append('filterByFormula', options.filterByFormula);
    }
    if (options.maxRecords) {
      params.append('maxRecords', options.maxRecords);
    }
    
    const queryString = params.toString();
    const endpoint = queryString ? `/table/${tableId}/record?${queryString}` : `/table/${tableId}/record`;
    
    const result = await this.request(endpoint);
    return result.records || [];
  }

  async getRecord(tableName, filter) {
    const records = await this.getRecords(tableName, filter);
    return records[0] || null;
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
  try {
    const template = fs.readFileSync(path.join(__dirname, 'views', `${name}.html`), 'utf8');
    return template.replace(/{{(\w+)}}/g, (match, key) => data[key] || '');
  } catch (error) {
    console.error(`Error loading template ${name}:`, error.message);
    return `<h1>Error loading template</h1><p>${error.message}</p>`;
  }
}

// Routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    teable_configured: !!(process.env.TEABLE_API_TOKEN && process.env.TEABLE_BASE_ID),
    config: {
      teable_url: process.env.TEABLE_URL,
      base_id: process.env.TEABLE_BASE_ID,
      has_token: !!process.env.TEABLE_API_TOKEN
    }
  });
});

// Survey page
app.get('/survey/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    console.log(`Loading survey for token: ${token}`);
    
    // Check if we have required config
    if (!process.env.TEABLE_API_TOKEN || !process.env.TEABLE_BASE_ID) {
      console.error('Missing Teable configuration');
      return res.status(500).send('Survey system not configured properly');
    }

    // For now, let's create a simple test survey without database lookup
    if (token === 'test') {
      const testSurvey = loadTemplate('survey', {
        title: 'Test Survey',
        description: 'This is a test survey to verify the system is working.',
        questions: `
          <div class="question">
            <label>How satisfied are you with our service? *</label>
            <div class="rating-group" data-question="overall_satisfaction">
              <button type="button" class="rating-btn" data-question="overall_satisfaction" data-value="1">1</button>
              <button type="button" class="rating-btn" data-question="overall_satisfaction" data-value="2">2</button>
              <button type="button" class="rating-btn" data-question="overall_satisfaction" data-value="3">3</button>
              <button type="button" class="rating-btn" data-question="overall_satisfaction" data-value="4">4</button>
              <button type="button" class="rating-btn" data-question="overall_satisfaction" data-value="5">5</button>
            </div>
            <input type="hidden" name="overall_satisfaction" required>
          </div>
          <div class="question">
            <label>Any additional comments?</label>
            <textarea name="additional_comments"></textarea>
          </div>
        `,
        token: token
      });
      return res.send(testSurvey);
    }
    
    // Try to get real survey from database
    const surveyResponses = await teable.getRecords('survey_responses', {
      filterByFormula: `{token} = "${token}"`,
      maxRecords: 1
    });

    if (!surveyResponses || surveyResponses.length === 0) {
      console.log(`No survey found for token: ${token}`);
      return res.status(404).send('Survey not found or expired');
    }

    const surveyResponse = surveyResponses[0];

    if (surveyResponse.fields.status === 'completed') {
      return res.send(loadTemplate('success', {
        message: 'Thank you! You have already completed this survey.'
      }));
    }

    // Get the default survey
    const surveys = await teable.getRecords('surveys', {
      filterByFormula: `{is_active} = TRUE()`,
      maxRecords: 1
    });

    if (!surveys || surveys.length === 0) {
      console.log('No active surveys found');
      return res.status(404).send('No surveys available');
    }

    const survey = surveys[0];
    let questions = [];
    
    try {
      questions = JSON.parse(survey.fields.questions || '[]');
    } catch (e) {
      console.error('Error parsing survey questions:', e);
      questions = [
        {
          id: 'overall_satisfaction',
          type: 'rating',
          question: 'How satisfied are you with our service?',
          scale: 5,
          required: true
        },
        {
          id: 'additional_comments',
          type: 'text',
          question: 'Any additional comments?',
          required: false
        }
      ];
    }
    
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
            <input type="hidden" name="${q.id}" ${q.required ? 'required' : ''}>
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
      return '';
    }).join('');

    res.send(loadTemplate('survey', {
      title: survey.fields.title || 'Customer Survey',
      description: survey.fields.description || '',
      questions: questionsHtml,
      token
    }));

  } catch (error) {
    console.error('Survey error:', error);
    res.status(500).send(`Error loading survey: ${error.message}`);
  }
});

// Submit survey
app.post('/survey/:token/submit', async (req, res) => {
  try {
    const { token } = req.params;
    const responses = req.body;

    console.log(`Submitting survey for token: ${token}`, responses);

    if (token === 'test') {
      console.log('Test survey submitted:', responses);
      return res.json({ success: true, message: 'Test survey submitted successfully' });
    }

    // Get survey response record
    const surveyResponses = await teable.getRecords('survey_responses', {
      filterByFormula: `{token} = "${token}"`,
      maxRecords: 1
    });

    if (!surveyResponses || surveyResponses.length === 0) {
      return res.status(400).json({ error: 'Survey not found' });
    }

    const surveyResponse = surveyResponses[0];

    if (surveyResponse.fields.status === 'completed') {
      return res.status(400).json({ error: 'Survey already completed' });
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

    console.log(`Survey submitted successfully for token: ${token}`);

    res.json({ success: true });

  } catch (error) {
    console.error('Submit error:', error);
    res.status(500).json({ error: `Failed to submit survey: ${error.message}` });
  }
});

// SyncroMSP webhook (placeholder)
app.post('/webhook/syncro', async (req, res) => {
  try {
    console.log('Received SyncroMSP webhook:', req.body);
    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`OpenCSAT server running on port ${PORT}`);
  console.log(`Teable URL: ${process.env.TEABLE_URL}`);
  console.log(`Teable Base ID: ${process.env.TEABLE_BASE_ID}`);
  console.log(`API Token configured: ${!!process.env.TEABLE_API_TOKEN}`);
});
