const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

// Import monitoring utilities
const { Logger, HealthMonitor, MetricsCollector, createMetricsMiddleware } = require('./monitoring');

const app = express();

// Initialize monitoring
const logger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  enableFile: process.env.ENABLE_FILE_LOGGING === 'true',
  logDir: process.env.LOG_DIR || './logs'
});

const metricsCollector = new MetricsCollector({ logger });
const healthMonitor = new HealthMonitor({ logger });

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// CORS Configuration
app.use((req, res, next) => {
  const allowedOrigins = [
    process.env.PUBLIC_ORIGIN,
    'http://localhost:3000',
    'http://localhost:8080'
  ].filter(Boolean);
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  
  next();
});

// Rate limiting
const surveyCreationLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.SURVEY_RATE_LIMIT_MAX) || 50,
  message: {
    error: 'Too many survey creation requests, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  onLimitReached: (req, res, options) => {
    logger.warn('Survey creation rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    metricsCollector.counter('rate_limit_exceeded', 1, { type: 'survey_creation' });
  }
});

const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 200,
  message: {
    error: 'Too many requests, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  onLimitReached: (req, res, options) => {
    logger.warn('General rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    metricsCollector.counter('rate_limit_exceeded', 1, { type: 'general' });
  }
});

// Apply middleware
app.use(generalLimiter);
app.use(createMetricsMiddleware(metricsCollector));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Input validation utilities
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    throw new Error('Email is required and must be a string');
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email format');
  }
  return email.trim().toLowerCase();
}

function validateTicketId(ticketId) {
  if (!ticketId || typeof ticketId !== 'string') {
    throw new Error('Ticket ID is required and must be a string');
  }
  if (!/^[a-zA-Z0-9\-_]{1,50}$/.test(ticketId)) {
    throw new Error('Invalid ticket ID format');
  }
  return ticketId.trim();
}

function validateName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Name is required and must be a string');
  }
  if (name.trim().length < 1 || name.trim().length > 100) {
    throw new Error('Name must be between 1 and 100 characters');
  }
  return name.trim();
}

function sanitizeString(str, maxLength = 255) {
  if (!str) return '';
  if (typeof str !== 'string') return String(str);
  return str.trim().substring(0, maxLength);
}

function validateToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Token is required and must be a string');
  }
  if (!/^[a-f0-9]{64}$/.test(token)) {
    throw new Error('Invalid token format');
  }
  return token;
}

// Environment validation
function validateEnvironment() {
  const required = ['TEABLE_API_TOKEN', 'TEABLE_BASE_ID'];
  const missing = required.filter(env => !process.env[env]);
  
  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    return false;
  }
  return true;
}

// Error response utility
function sendErrorResponse(res, error, statusCode = 500) {
  logger.error('API Error', { 
    error: error.message, 
    stack: error.stack,
    statusCode,
    url: res.req?.url,
    method: res.req?.method
  });
  
  metricsCollector.counter('errors_total', 1, {
    status_code: statusCode.toString(),
    error_type: error.code || 'UNKNOWN'
  });
  
  const errorResponse = {
    error: error.message || 'Internal server error',
    code: error.code || 'INTERNAL_ERROR',
    timestamp: new Date().toISOString()
  };
  
  if (process.env.NODE_ENV !== 'production') {
    errorResponse.stack = error.stack;
  }
  
  res.status(statusCode).json(errorResponse);
}

// Improved Teable client using axios
class Teable {
  constructor() {
    this.baseUrl = process.env.TEABLE_URL || 'http://localhost:3000';
    this.token = process.env.TEABLE_API_TOKEN;
    this.baseId = process.env.TEABLE_BASE_ID;
    
    this.client = axios.create({
      baseURL: `${this.baseUrl}/api`,
      timeout: 30000,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'OpenCSAT/1.0'
      }
    });
    
    this.client.interceptors.request.use(request => {
      metricsCollector.counter('teable_requests_total', 1, {
        method: request.method.toUpperCase(),
        endpoint: request.url
      });
      return request;
    });
    
    this.client.interceptors.response.use(
      response => {
        metricsCollector.counter('teable_responses_total', 1, {
          status_code: response.status.toString()
        });
        return response.data;
      },
      error => {
        const status = error.response?.status || 0;
        metricsCollector.counter('teable_responses_total', 1, {
          status_code: status.toString()
        });
        
        const message = error.response?.data?.message || error.message;
        const enhancedError = new Error(`Teable API Error (${status}): ${message}`);
        enhancedError.status = status;
        enhancedError.code = 'TEABLE_API_ERROR';
        
        logger.error('Teable API Error', {
          status,
          message,
          url: error.config?.url,
          method: error.config?.method
        });
        
        throw enhancedError;
      }
    );
  }

  async getTableId(tableName) {
    try {
      const tables = await this.client.get(`/base/${this.baseId}/table`);
      const table = tables.find(t => t.name === tableName);
      if (!table) {
        throw new Error(`Table '${tableName}' not found`);
      }
      return table.id;
    } catch (error) {
      logger.error(`Error getting table ID for ${tableName}`, { error: error.message });
      throw error;
    }
  }

  async createRecord(tableName, data) {
    const tableId = await this.getTableId(tableName);
    const result = await this.client.post(`/table/${tableId}/record`, {
      records: [{ fields: data }]
    });
    
    metricsCollector.counter('records_created', 1, { table: tableName });
    logger.info(`Record created in ${tableName}`, { recordId: result.records?.[0]?.id });
    
    return result;
  }

  async getRecords(tableName, options = {}) {
    const tableId = await this.getTableId(tableName);
    const params = {};
    
    if (options.filterByFormula) {
      params.filterByFormula = options.filterByFormula;
    }
    if (options.maxRecords) {
      params.maxRecords = options.maxRecords;
    }
    
    const result = await this.client.get(`/table/${tableId}/record`, { params });
    
    metricsCollector.counter('records_retrieved', result.records?.length || 0, { table: tableName });
    
    return result.records || [];
  }

  async getRecord(tableName, filter) {
    const records = await this.getRecords(tableName, filter);
    return records[0] || null;
  }

  async updateRecord(tableName, recordId, data) {
    const tableId = await this.getTableId(tableName);
    const result = await this.client.patch(`/table/${tableId}/record/${recordId}`, {
      record: {
        fields: data
      }
    });
    
    metricsCollector.counter('records_updated', 1, { table: tableName });
    logger.info(`Record updated in ${tableName}`, { recordId });
    
    return result;
  }
}

const teable = new Teable();

// Generate survey token with collision detection
async function generateUniqueToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Load HTML template
function loadTemplate(name, data = {}) {
  try {
    const template = fs.readFileSync(path.join(__dirname, 'views', `${name}.html`), 'utf8');
    return template.replace(/{{(\w+)}}/g, (match, key) => data[key] || '');
  } catch (error) {
    logger.error(`Error loading template ${name}`, { error: error.message });
    return `<h1>Error loading template</h1><p>${error.message}</p>`;
  }
}

// Setup health checks
healthMonitor.addCheck('teable_connectivity', async () => {
  await teable.client.get('/space', { timeout: 5000 });
  return { status: 'connected', timestamp: new Date().toISOString() };
}, { timeout: 6000, critical: true });

healthMonitor.addCheck('database_access', async () => {
  const tables = await teable.client.get(`/base/${teable.baseId}/table`, { timeout: 5000 });
  return { 
    status: 'accessible', 
    tableCount: tables.length,
    timestamp: new Date().toISOString() 
  };
}, { timeout: 6000, critical: true });

healthMonitor.addCheck('file_system', async () => {
  const viewsPath = path.join(__dirname, 'views');
  const files = fs.readdirSync(viewsPath);
  return { 
    status: 'accessible',
    viewFiles: files.length,
    timestamp: new Date().toISOString() 
  };
}, { timeout: 1000, critical: false });

// Health check endpoint with comprehensive monitoring
app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    teable_configured: !!(process.env.TEABLE_API_TOKEN && process.env.TEABLE_BASE_ID),
    config: {
      teable_url: process.env.TEABLE_URL,
      base_id: process.env.TEABLE_BASE_ID,
      has_token: !!process.env.TEABLE_API_TOKEN,
      node_env: process.env.NODE_ENV || 'development'
    }
  };
  
  // Get health monitor status
  const healthStatus = healthMonitor.getStatus();
  health.healthChecks = healthStatus;
  
  // Get metrics
  health.metrics = metricsCollector.getMetrics();
  
  // Determine overall status
  if (healthStatus.status === 'unhealthy' || healthStatus.criticalFailures > 0) {
    health.status = 'unhealthy';
  } else if (healthStatus.healthyChecks < healthStatus.totalChecks) {
    health.status = 'degraded';
  }
  
  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Metrics endpoint
app.get('/metrics', (req, res) => {
  const metrics = metricsCollector.getMetrics();
  res.json({
    timestamp: new Date().toISOString(),
    metrics
  });
});

app.get('/survey/create-and-redirect', surveyCreationLimiter, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const ticket_id = validateTicketId(req.query.ticket_id);
    const customer_email = validateEmail(req.query.customer_email);
    const customer_name = validateName(req.query.customer_name);
    
    const ticket_subject = sanitizeString(req.query.ticket_subject, 255);
    const technician_name = sanitizeString(req.query.technician_name, 100);
    const company_name = sanitizeString(req.query.company_name, 100);
    const completion_date = req.query.completion_date || new Date().toISOString();
    const priority = sanitizeString(req.query.priority, 50);
    const category = sanitizeString(req.query.category, 100);

    logger.info('Creating survey', { 
      ticket_id, 
      customer_email, 
      technician_name,
      company_name 
    });

    const token = await generateUniqueToken();
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + (parseInt(process.env.SURVEY_EXPIRY_DAYS) || 30));

    await teable.createRecord('survey_responses', {
      Name: `Survey Response - ${ticket_id}`,
      token,
      status: 'pending',
      ticket_external_id: ticket_id,
      customer_email,
      customer_name,
      ticket_subject,
      technician_name,
      company_name,
      completion_date,
      priority,
      category,
      expires_at: expiryDate.toISOString(),
      created_at: new Date().toISOString()
    });

    const duration = Date.now() - startTime;
    metricsCollector.histogram('survey_creation_duration_ms', duration);
    metricsCollector.counter('surveys_created', 1);
    
    logger.info('Survey created successfully', { token, ticket_id, duration });
    res.redirect(`/survey/${token}`);
  } catch (error) {
    const duration = Date.now() - startTime;
    metricsCollector.histogram('survey_creation_duration_ms', duration, { status: 'error' });
    
    if (error.message.includes('Email') || error.message.includes('Ticket ID') || error.message.includes('Name')) {
      sendErrorResponse(res, error, 400);
    } else {
      logger.error('Survey creation error', { error: error.message, stack: error.stack });
      sendErrorResponse(res, new Error('Error creating survey. Please contact support.'), 500);
    }
  }
});


// Survey page display
app.get('/survey/:token', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { token } = req.params;
    
    logger.info('Loading survey', { token });
    
    if (token === 'test') {
      const testSurvey = loadTemplate('survey', {
        title: 'Test Survey',
        description: 'This is a test survey to verify the system is working.',
        ticket_context: `
          <div class="ticket-context">
            <h3>📋 Test Ticket Details</h3>
            <div class="ticket-details">
              <p><strong>Ticket #:</strong> TEST-001</p>
              <p><strong>Subject:</strong> Test Support Request</p>
              <p><strong>Technician:</strong> Test Technician</p>
              <p><strong>Company:</strong> Test Company</p>
              <p><strong>Completed:</strong> ${new Date().toLocaleDateString()}</p>
            </div>
          </div>
        `,
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
      
      metricsCollector.counter('test_surveys_viewed', 1);
      return res.send(testSurvey);
    }
    
    try {
      validateToken(token);
    } catch (error) {
      metricsCollector.counter('invalid_tokens', 1);
      return res.status(400).send('Invalid survey token format');
    }
    
    if (!process.env.TEABLE_API_TOKEN || !process.env.TEABLE_BASE_ID) {
      logger.error('Missing Teable configuration');
      return res.status(500).send('Survey system not configured properly');
    }

    const surveyResponses = await teable.getRecords('survey_responses', {
      filterByFormula: `AND({token} = "${token}", {token} != "")`,
      maxRecords: 1
    });

    if (!surveyResponses || surveyResponses.length === 0) {
      logger.warn('Survey not found', { token });
      metricsCollector.counter('surveys_not_found', 1);
      return res.status(404).send('Survey not found or expired');
    }

    const surveyResponse = surveyResponses[0];

    if (surveyResponse.fields.token !== token) {
      logger.error('Token mismatch', { expected: token, got: surveyResponse.fields.token });
      metricsCollector.counter('token_mismatches', 1);
      return res.status(404).send('Survey not found or expired');
    }

    if (surveyResponse.fields.status === 'completed') {
      metricsCollector.counter('completed_surveys_accessed', 1);
      return res.send(loadTemplate('success', {
        message: 'Thank you! You have already completed this survey.'
      }));
    }

    if (surveyResponse.fields.expires_at) {
      const expiryDate = new Date(surveyResponse.fields.expires_at);
      if (expiryDate < new Date()) {
        metricsCollector.counter('expired_surveys_accessed', 1);
        return res.status(410).send('This survey has expired');
      }
    }

    const ticketContext = `
      <div class="ticket-context">
        <h3>📋 Ticket Details</h3>
        <div class="ticket-details">
          <p><strong>Ticket #:</strong> ${surveyResponse.fields.ticket_external_id || 'N/A'}</p>
          <p><strong>Subject:</strong> ${surveyResponse.fields.ticket_subject || 'N/A'}</p>
          <p><strong>Technician:</strong> ${surveyResponse.fields.technician_name || 'N/A'}</p>
          <p><strong>Company:</strong> ${surveyResponse.fields.company_name || 'N/A'}</p>
          <p><strong>Completed:</strong> ${surveyResponse.fields.completion_date ? new Date(surveyResponse.fields.completion_date).toLocaleDateString() : 'N/A'}</p>
          ${surveyResponse.fields.priority ? `<p><strong>Priority:</strong> ${surveyResponse.fields.priority}</p>` : ''}
          ${surveyResponse.fields.category ? `<p><strong>Category:</strong> ${surveyResponse.fields.category}</p>` : ''}
        </div>
      </div>
    `;

    const surveys = await teable.getRecords('surveys', {
      filterByFormula: `{is_active} = TRUE()`,
      maxRecords: 1
    });

    if (!surveys || surveys.length === 0) {
      logger.error('No active surveys found');
      return res.status(404).send('No surveys available');
    }

    const survey = surveys[0];
    let questions = [];
    
    try {
      questions = JSON.parse(survey.fields.questions || '[]');
    } catch (e) {
      logger.error('Error parsing survey questions', { error: e.message });
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

    const duration = Date.now() - startTime;
    metricsCollector.histogram('survey_load_duration_ms', duration);
    metricsCollector.counter('surveys_viewed', 1);

    res.send(loadTemplate('survey', {
      title: survey.fields.Name || 'Customer Survey',
      description: survey.fields.description || '',
      ticket_context: ticketContext,
      questions: questionsHtml,
      token
    }));

  } catch (error) {
    const duration = Date.now() - startTime;
    metricsCollector.histogram('survey_load_duration_ms', duration, { status: 'error' });
    logger.error('Survey loading error', { error: error.message, stack: error.stack });
    sendErrorResponse(res, error, 500);
  }
});

// Submit survey
app.post('/survey/:token/submit', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { token } = req.params;
    const responses = req.body;

    logger.info('Submitting survey', { token, responseCount: Object.keys(responses).length });

    if (token === 'test') {
      metricsCollector.counter('test_surveys_submitted', 1);
      logger.info('Test survey submitted', { responses });
      return res.json({ success: true, message: 'Test survey submitted successfully' });
    }

    try {
      validateToken(token);
    } catch (error) {
      metricsCollector.counter('invalid_submit_tokens', 1);
      return res.status(400).json({ error: 'Invalid token format', code: 'INVALID_TOKEN' });
    }

    const surveyResponses = await teable.getRecords('survey_responses', {
      filterByFormula: `AND({token} = "${token}", {token} != "")`,
      maxRecords: 1
    });

    if (!surveyResponses || surveyResponses.length === 0) {
      metricsCollector.counter('submit_surveys_not_found', 1);
      return res.status(404).json({ error: 'Survey not found', code: 'SURVEY_NOT_FOUND' });
    }

    const surveyResponse = surveyResponses[0];

    if (surveyResponse.fields.token !== token) {
      logger.error('Token mismatch during submit', { expected: token, got: surveyResponse.fields.token });
      metricsCollector.counter('submit_token_mismatches', 1);
      return res.status(404).json({ error: 'Survey not found', code: 'SURVEY_NOT_FOUND' });
    }

    if (surveyResponse.fields.status === 'completed') {
      metricsCollector.counter('duplicate_submissions', 1);
      return res.status(400).json({ error: 'Survey already completed', code: 'ALREADY_COMPLETED' });
    }

    if (surveyResponse.fields.expires_at) {
      const expiryDate = new Date(surveyResponse.fields.expires_at);
      if (expiryDate < new Date()) {
        metricsCollector.counter('expired_survey_submissions', 1);
        return res.status(410).json({ error: 'Survey has expired', code: 'SURVEY_EXPIRED' });
      }
    }

    const sanitizedResponses = {};
    for (const [key, value] of Object.entries(responses)) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
        continue;
      }
      
      if (typeof value === 'string') {
        sanitizedResponses[key] = sanitizeString(value, 1000);
      } else if (typeof value === 'number' && !isNaN(value)) {
        sanitizedResponses[key] = value;
      }
    }

    const ratingValues = Object.entries(sanitizedResponses)
      .filter(([key, value]) => !isNaN(value))
      .map(([key, value]) => parseInt(value));
    
    const overallRating = ratingValues.length > 0 
      ? Math.round(ratingValues.reduce((a, b) => a + b, 0) / ratingValues.length)
      : null;

    await teable.updateRecord('survey_responses', surveyResponse.id, {
      Name: `Survey Response - ${surveyResponse.fields.ticket_external_id || 'Unknown'}`,
      status: 'completed',
      responses: JSON.stringify(sanitizedResponses),
      overall_rating: overallRating,
      comments: sanitizedResponses.additional_comments || '',
      submitted_at: new Date().toISOString()
    });

    const duration = Date.now() - startTime;
    metricsCollector.histogram('survey_submit_duration_ms', duration);
    metricsCollector.counter('surveys_submitted', 1);
    
    if (overallRating) {
      metricsCollector.histogram('survey_ratings', overallRating);
    }

    logger.info('Survey submitted successfully', { token, overallRating, duration });
    res.json({ success: true, code: 'SURVEY_SUBMITTED' });

  } catch (error) {
    const duration = Date.now() - startTime;
    metricsCollector.histogram('survey_submit_duration_ms', duration, { status: 'error' });
    logger.error('Submit error', { error: error.message, stack: error.stack });
    sendErrorResponse(res, error, 500);
  }
});

// SyncroMSP webhook
app.post('/webhook/syncro', async (req, res) => {
  try {
    logger.info('Received SyncroMSP webhook', { body: req.body });
    metricsCollector.counter('webhooks_received', 1, { source: 'syncro' });
    res.json({ received: true, timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error('Webhook error', { error: error.message });
    sendErrorResponse(res, error, 500);
  }
});

// 404 handler
app.use('*', (req, res) => {
  logger.warn('404 Not Found', { url: req.originalUrl, method: req.method, ip: req.ip });
  metricsCollector.counter('not_found_requests', 1, { path: req.originalUrl });
  
  res.status(404).json({
    error: 'Endpoint not found',
    code: 'NOT_FOUND',
    path: req.originalUrl,
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { 
    error: err.message, 
    stack: err.stack,
    url: req.url,
    method: req.method
  });
  sendErrorResponse(res, err, err.status || 500);
});

// Start server
const PORT = process.env.PORT || 3000;

// Only start server if environment is properly configured
if (process.env.NODE_ENV === 'production' && !validateEnvironment()) {
  logger.error('Server startup aborted due to missing configuration');
  process.exit(1);
}

// Start monitoring if enabled
if (process.env.ENABLE_MONITORING !== 'false') {
  logger.info('Starting monitoring services');
  metricsCollector.start();
  healthMonitor.start();
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    healthMonitor.stop();
    metricsCollector.stop();
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    healthMonitor.stop();
    metricsCollector.stop();
    process.exit(0);
  });
}

app.listen(PORT, () => {
  logger.info('OpenCSAT server starting', {
    port: PORT,
    nodeEnv: process.env.NODE_ENV,
    teableUrl: process.env.TEABLE_URL,
    hasToken: !!process.env.TEABLE_API_TOKEN,
    hasBaseId: !!process.env.TEABLE_BASE_ID,
    monitoringEnabled: process.env.ENABLE_MONITORING !== 'false'
  });
  
  console.log(`🚀 OpenCSAT server running on port ${PORT}`);
  console.log(`🔗 Teable URL: ${process.env.TEABLE_URL}`);
  console.log(`📊 Teable Base ID: ${process.env.TEABLE_BASE_ID}`);
  console.log(`🔑 API Token configured: ${!!process.env.TEABLE_API_TOKEN}`);
  
  if (!process.env.TEABLE_API_TOKEN || !process.env.TEABLE_BASE_ID) {
    console.log('\n⚠️  Missing configuration detected:');
    console.log('   1. Ensure Teable setup has completed successfully');
    console.log('   2. Check that TEABLE_BASE_ID is set in your .env file');
    console.log('   3. Verify TEABLE_API_TOKEN is configured');
    console.log('   4. Test with: curl http://localhost:' + PORT + '/health');
  } else {
    console.log('\n✅ OpenCSAT ready to accept survey requests!');
    console.log(`   Test survey: http://localhost:${PORT}/survey/test`);
    console.log(`   Health check: http://localhost:${PORT}/health`);
    console.log(`   Metrics: http://localhost:${PORT}/metrics`);
    
    if (process.env.ENABLE_MONITORING !== 'false') {
      console.log('   🔍 Monitoring: Enabled with health checks and metrics collection');
    }
  }
});