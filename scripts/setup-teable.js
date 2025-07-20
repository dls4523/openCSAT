#!/usr/bin/env node

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

class TeableSetup {
    constructor() {
        this.config = {
            teableUrl: process.env.TEABLE_URL || 'http://localhost:3000',
            apiToken: process.env.TEABLE_API_TOKEN,
            baseId: process.env.TEABLE_BASE_ID,
            spaceId: process.env.TEABLE_SPACE_ID,
        };
        
        this.requiredTables = [
            'surveys',
            'tickets',
            'survey_questions', 
            'survey_responses',
            'system_config',
            'email_templates',
            'webhook_logs'
        ];
    }

    async makeRequest(endpoint, method = 'GET', data = null) {
        return new Promise((resolve, reject) => {
            const url = new URL(`${this.config.teableUrl}/api${endpoint}`);
            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                method: method,
                headers: {
                    'Authorization': `Bearer ${this.config.apiToken}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'OpenCSAT-Setup/1.0'
                }
            };

            if (data && method !== 'GET') {
                const jsonData = JSON.stringify(data);
                options.headers['Content-Length'] = Buffer.byteLength(jsonData);
            }

            const client = url.protocol === 'https:' ? https : http;
            const req = client.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => {
                    try {
                        const result = body ? JSON.parse(body) : {};
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(result);
                        } else {
                            reject(new Error(`HTTP ${res.statusCode}: ${result.message || body}`));
                        }
                    } catch (e) {
                        reject(new Error(`Parse error: ${e.message}, Body: ${body}`));
                    }
                });
            });

            req.on('error', reject);
            
            if (data && method !== 'GET') {
                req.write(JSON.stringify(data));
            }
            
            req.end();
        });
    }

    async checkTeableConnection() {
        console.log('Checking Teable connection...');
        try {
            await this.makeRequest('/space');
            console.log('Teable is accessible');
            return true;
        } catch (error) {
            console.error(`Cannot connect to Teable: ${error.message}`);
            return false;
        }
    }

    async findOrCreateSpace() {
        console.log('Finding or creating OpenCSAT space...');
        try {
            // Get all spaces
            const spaces = await this.makeRequest('/space');
            let opencsatSpace = spaces.find(space => space.name === 'OpenCSAT');
            
            if (opencsatSpace) {
                console.log(`Found existing OpenCSAT space: ${opencsatSpace.id}`);
                this.config.spaceId = opencsatSpace.id;
                return true;
            }

            console.log('Creating OpenCSAT space...');
            opencsatSpace = await this.makeRequest('/space', 'POST', {
                name: 'OpenCSAT'
            });
            console.log(`Created OpenCSAT space: ${opencsatSpace.id}`);
            
            this.config.spaceId = opencsatSpace.id;

            await new Promise(resolve => setTimeout(resolve, 3000));
            
            return true;
        } catch (error) {
            console.error(`Error with space: ${error.message}`);
            
            return false;
        }
    }

    async findOrCreateBase() {
        console.log('Finding or creating OpenCSAT base...');
        try {
            console.log(`Checking bases in space: ${this.config.spaceId}`);
            const basesInSpace = await this.makeRequest(`/space/${this.config.spaceId}/base`);
            
            let opencsatBase = basesInSpace.find(base => base.name === 'OpenCSAT');
            
            if (opencsatBase) {
                console.log(`Found existing OpenCSAT base: ${opencsatBase.id}`);
                this.config.baseId = opencsatBase.id;
                return true;
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
            
            console.log('Creating OpenCSAT base in space...');
            opencsatBase = await this.makeRequest('/base', 'POST', {
                spaceId: this.config.spaceId,
                name: 'OpenCSAT'
            });
            console.log(`Created OpenCSAT base: ${opencsatBase.id}`);
            this.config.baseId = opencsatBase.id;
            return true;
            
        } catch (error) {
            console.error(`Error with base: ${error.message}`);
            
            if (error.message.includes('403') || error.message.includes('not allowed')) {
                try {
                    console.log('🔧 Trying to create base without space specification...');
                    const opencsatBase = await this.makeRequest('/base', 'POST', {
                        name: 'OpenCSAT'
                    });
                    console.log(`Created OpenCSAT base: ${opencsatBase.id}`);
                    this.config.baseId = opencsatBase.id;
                    return true;
                } catch (fallbackError) {
                    console.error(`Fallback creation failed: ${fallbackError.message}`);
                }
            }
            
            if (error.message.includes('404') || error.message.includes('Cannot GET')) {
                try {
                    console.log('🔧 Trying alternative base creation approach...');
                    const opencsatBase = await this.makeRequest('/base', 'POST', {
                        name: 'OpenCSAT'
                    });
                    console.log(`Created OpenCSAT base: ${opencsatBase.id}`);
                    this.config.baseId = opencsatBase.id;
                    return true;
                } catch (altError) {
                    console.error(`Alternative approach failed: ${altError.message}`);
                }
            }
            
            return false;
        }
    }

    async ensureTablesExist() {
        console.log('Creating required tables...');
        try {
            const tables = await this.makeRequest(`/base/${this.config.baseId}/table`);
            const existingTables = tables.map(table => table.name);
            
            for (const tableName of this.requiredTables) {
                if (existingTables.includes(tableName)) {
                    console.log(`Table '${tableName}' already exists`);
                } else {
                    console.log(`Creating table '${tableName}'...`);
                    try {
                        await this.makeRequest(`/base/${this.config.baseId}/table`, 'POST', {
                            name: tableName,
                            description: `OpenCSAT ${tableName} table`
                        });
                        console.log(`Created table '${tableName}'`);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } catch (tableError) {
                        if (tableError.message.includes('already exists')) {
                            console.log(`Table '${tableName}' already exists`);
                        } else {
                            console.error(`Failed to create table '${tableName}': ${tableError.message}`);
                        }
                    }
                }
            }
            
            return true;
        } catch (error) {
            console.error(`Error managing tables: ${error.message}`);
            return false;
        }
    }

    async setupBasicFields() {
        console.log('Setting up basic table fields...');
        
        try {
            const tables = await this.makeRequest(`/base/${this.config.baseId}/table`);
            const tableIds = {};
            tables.forEach(table => {
                tableIds[table.name] = table.id;
            });

            if (tableIds.surveys) {
                console.log('Setting up surveys table...');
                
                await this.createFieldIfNotExists(tableIds.surveys, 'description', {
                    name: 'description',
                    type: 'longText'
                });
                
                await this.createFieldIfNotExists(tableIds.surveys, 'questions', {
                    name: 'questions',
                    type: 'longText'
                });

                await this.createFieldIfNotExists(tableIds.surveys, 'is_active', {
                    name: 'is_active',
                    type: 'checkbox'
                });
            }

            if (tableIds.tickets) {
                console.log('Setting up tickets table...');
                
                await this.createFieldIfNotExists(tableIds.tickets, 'external_id', {
                    name: 'external_id',
                    type: 'singleLineText'
                });

                await this.createFieldIfNotExists(tableIds.tickets, 'customer_email', {
                    name: 'customer_email',
                    type: 'singleLineText'
                });

                await this.createFieldIfNotExists(tableIds.tickets, 'customer_name', {
                    name: 'customer_name',
                    type: 'singleLineText'
                });

                await this.createFieldIfNotExists(tableIds.tickets, 'subject', {
                    name: 'subject',
                    type: 'singleLineText'
                });

                await this.createFieldIfNotExists(tableIds.tickets, 'status', {
                    name: 'status',
                    type: 'singleLineText'
                });

                await this.createFieldIfNotExists(tableIds.tickets, 'closed_at', {
                    name: 'closed_at',
                    type: 'date'
                });
            }

            if (tableIds.survey_questions) {
                console.log('Setting up survey_questions table...');
                await this.createFieldIfNotExists(tableIds.survey_questions, 'id', {
                    name: 'id',
                    type: 'autoNumber'
                });

                await this.createFieldIfNotExists(tableIds.survey_questions, 'text', {
                    name: 'text',
                    type: 'singleLineText'
                });

                await this.createFieldIfNotExists(tableIds.survey_questions, 'answer_type', {
                    name: 'answer_type',
                    type: 'singleSelect',
                    options: {
                        choices: [
                            { name: 'rating' },
                            { name: 'yes_no' }
                        ]
                    }
                });

                await this.createFieldIfNotExists(tableIds.survey_questions, 'responses', {
                    name: 'responses',
                    type: 'longText'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'overall_rating', {
                    name: 'overall_rating',
                    type: 'number'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'comments', {
                    name: 'comments',
                    type: 'longText'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'ticket_external_id', {
                    name: 'ticket_external_id',
                    type: 'singleLineText'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'completion_date', {
                    name: 'completion_date',
                    type: 'date'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'submitted_at', {
                    name: 'submitted_at',
                    type: 'date'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'expires_at', {
                    name: 'expires_at',
                    type: 'date'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'created_at', {
                    name: 'created_at',
                    type: 'date'
                });
            }

            if (tableIds.survey_responses) {
                console.log('Setting up survey_responses table...');
                await this.createFieldIfNotExists(tableIds.survey_responses, 'token', {
                    name: 'token',
                    type: 'singleLineText'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'status', {
                    name: 'status',
                    type: 'singleSelect',
                    options: {
                        choices: [
                            { name: 'pending' },
                            { name: 'completed' },
                            { name: 'expired' }
                        ]
                    }
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'responses', {
                    name: 'responses',
                    type: 'longText'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'overall_rating', {
                    name: 'overall_rating',
                    type: 'number'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'comments', {
                    name: 'comments',
                    type: 'longText'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'ticket_external_id', {
                    name: 'ticket_external_id',
                    type: 'singleLineText'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'customer_email', {
                    name: 'customer_email',
                    type: 'singleLineText'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'customer_name', {
                    name: 'customer_name',
                    type: 'singleLineText'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'ticket_subject', {
                    name: 'ticket_subject',
                    type: 'singleLineText'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'technician_name', {
                    name: 'technician_name',
                    type: 'singleLineText'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'company_name', {
                    name: 'company_name',
                    type: 'singleLineText'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'completion_date', {
                    name: 'completion_date',
                    type: 'date'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'priority', {
                    name: 'priority',
                    type: 'singleLineText'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'category', {
                    name: 'category',
                    type: 'singleLineText'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'submitted_at', {
                    name: 'submitted_at',
                    type: 'date'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'expires_at', {
                    name: 'expires_at',
                    type: 'date'
                });

                await this.createFieldIfNotExists(tableIds.survey_responses, 'created_at', {
                    name: 'created_at',
                    type: 'date'
                });
            }

            if (tableIds.system_config) {
                console.log('Setting up system_config table...');
                
                await this.createFieldIfNotExists(tableIds.system_config, 'value', {
                    name: 'value',
                    type: 'singleLineText'
                });

                await this.createFieldIfNotExists(tableIds.system_config, 'description', {
                    name: 'description',
                    type: 'longText'
                });
            }

            if (tableIds.email_templates) {
                console.log('Setting up email_templates table...');
                
                await this.createFieldIfNotExists(tableIds.email_templates, 'subject', {
                    name: 'subject',
                    type: 'singleLineText'
                });

                await this.createFieldIfNotExists(tableIds.email_templates, 'body', {
                    name: 'body',
                    type: 'longText'
                });

                await this.createFieldIfNotExists(tableIds.email_templates, 'is_active', {
                    name: 'is_active',
                    type: 'checkbox'
                });
            }

            if (tableIds.webhook_logs) {
                console.log('Setting up webhook_logs table...');
                await this.createFieldIfNotExists(tableIds.webhook_logs, 'source', {
                    name: 'source',
                    type: 'singleLineText'
                });

                await this.createFieldIfNotExists(tableIds.webhook_logs, 'event_type', {
                    name: 'event_type',
                    type: 'singleLineText'
                });

                await this.createFieldIfNotExists(tableIds.webhook_logs, 'payload', {
                    name: 'payload',
                    type: 'longText'
                });

                await this.createFieldIfNotExists(tableIds.webhook_logs, 'processed', {
                    name: 'processed',
                    type: 'checkbox'
                });

                await this.createFieldIfNotExists(tableIds.webhook_logs, 'error_message', {
                    name: 'error_message',
                    type: 'longText'
                });

                await this.createFieldIfNotExists(tableIds.webhook_logs, 'created_at', {
                    name: 'created_at',
                    type: 'createdTime'
                });
            }

            console.log('Basic fields setup complete');
        } catch (error) {
            console.log('Some fields may already exist or failed to create:', error.message);
        }
    }

    async createFieldIfNotExists(tableId, fieldName, fieldConfig) {
        try {
            const existingFields = await this.makeRequest(`/table/${tableId}/field`);
            const fieldExists = existingFields.some(field => field.name === fieldName);
            
            if (fieldExists) {
                console.log(`Field '${fieldName}' already exists`);
                return;
            }
            
            await this.makeRequest(`/table/${tableId}/field`, 'POST', fieldConfig);
            console.log(`Created field '${fieldName}'`);
        } catch (error) {
            if (error.message.includes('already exists') || 
                error.message.includes('duplicate') || 
                error.message.includes('exist') ||
                error.message.includes('Field name already exists')) {
                console.log(`Field '${fieldName}' already exists`);
            } else {
                console.log(`Could not create field '${fieldName}': ${error.message}`);
            }
        }
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    async cleanupEmptyRecords(tableId) {
        try {
            console.log('Cleaning up empty records...');
            const records = await this.makeRequest(`/table/${tableId}/record`);
            
            console.log(`Found ${records.records?.length || 0} total records`);
            
            if (records.records && records.records.length > 0) {
                let deletedCount = 0;
                for (const record of records.records) {
                    console.log(`Checking record ${record.id}:`);
                    console.log(`- Fields: ${JSON.stringify(record.fields)}`);
                    console.log(`- Field keys: ${Object.keys(record.fields || {})}`);
                    console.log(`- Has title: ${!!(record.fields && record.fields.title)}`);
                    
                    if (!record.fields || Object.keys(record.fields).length === 0 || !record.fields.title) {
                        console.log(`Deleting empty record: ${record.id}`);
                        try {
                            await this.makeRequest(`/table/${tableId}/record/${record.id}`, 'DELETE');
                            deletedCount++;
                            await new Promise(resolve => setTimeout(resolve, 200));
                        } catch (deleteError) {
                            console.log(`Could not delete record ${record.id}: ${deleteError.message}`);
                        }
                    } else {
                        console.log(`Keeping record ${record.id} (has data)`);
                    }
                }
                console.log(`Cleaned up ${deletedCount} empty records`);
            } else {
                console.log('No records to clean up');
            }
            
        } catch (error) {
            console.log('Error during cleanup:', error.message);
        }
    }

    async cleanupUnusedDefaultFields() {
        console.log('Cleaning up unused default fields...');
        
        const requiredFields = {
            'surveys': ['Name', 'description', 'questions', 'is_active'],
            'tickets': ['Name', 'external_id', 'customer_email', 'customer_name', 'subject', 'status', 'closed_at'],
            'survey_questions': ['id', 'text', 'answer_type'],
            'survey_responses': ['Name', 'token', 'status', 'responses', 'overall_rating', 'comments', 'ticket_external_id', 
                               'customer_email', 'customer_name', 'ticket_subject', 'technician_name', 'company_name', 
                               'completion_date', 'priority', 'category', 'submitted_at', 'expires_at', 'created_at'],
            'system_config': ['Name', 'value', 'description'],
            'email_templates': ['Name', 'subject', 'body', 'is_active'],
            'webhook_logs': ['Name', 'source', 'event_type', 'payload', 'processed', 'error_message', 'created_at']
        };
        
        try {
            const tables = await this.makeRequest(`/base/${this.config.baseId}/table`);
            
            for (const table of tables) {
                if (!requiredFields[table.name]) {
                    console.log(`Skipping unknown table: ${table.name}`);
                    continue;
                }
                
                console.log(`Cleaning fields in table: ${table.name}`);
                const fields = await this.makeRequest(`/table/${table.id}/field`);
                
                const unusedFields = fields.filter(field => 
                    !requiredFields[table.name].includes(field.name) &&
                    field.name !== 'id' &&
                    field.name !== 'Name' &&
                    !field.isPrimary
                );
                
                for (const field of unusedFields) {
                    console.log(`Deleting unused field: ${field.name} from ${table.name}`);
                    try {
                        await this.makeRequest(`/table/${table.id}/field/${field.id}`, 'DELETE');
                        await new Promise(resolve => setTimeout(resolve, 300));
                    } catch (deleteError) {
                        console.log(`Could not delete field ${field.name}: ${deleteError.message}`);
                    }
                }
            }
            
            console.log('Unused default fields cleanup complete');
        } catch (error) {
            console.log('Error during default field cleanup:', error.message);
        }
    }

    async cleanupAllEmptyRecords() {
        console.log('Cleaning up empty records from all tables...');
        
        try {
            const tables = await this.makeRequest(`/base/${this.config.baseId}/table`);
            
            for (const table of tables) {
                console.log(`Checking table: ${table.name}`);
                await this.cleanupEmptyRecords(table.id);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            console.log('All tables cleaned up');
        } catch (error) {
            console.log('Error during full cleanup:', error.message);
        }
    }

    async addDefaultData() {
        console.log('Adding default survey...');
        
        try {
            const tables = await this.makeRequest(`/base/${this.config.baseId}/table`);
            const surveysTable = tables.find(t => t.name === 'surveys');
            
            if (!surveysTable) {
                console.log('Surveys table not found, skipping default data');
                return;
            }

            const existingRecords = await this.makeRequest(`/table/${surveysTable.id}/record?maxRecords=1`);
            if (existingRecords.records && existingRecords.records.some(r => r.fields && r.fields.Name)) {
                console.log('⏭Default survey already exists, skipping');
                return;
            }
            
            const defaultSurvey = {
                Name: 'Customer Satisfaction Survey',
                description: 'Help us improve our service by rating your experience',
                questions: JSON.stringify([
                    {
                        id: 'overall_satisfaction',
                        type: 'rating',
                        question: 'How satisfied are you with the resolution of your support request?',
                        scale: 5,
                        required: true
                    },
                    {
                        id: 'response_time',
                        type: 'rating',
                        question: 'How satisfied are you with the response time?',
                        scale: 5,
                        required: true
                    },
                    {
                        id: 'technical_quality',
                        type: 'rating',
                        question: 'How satisfied are you with the technical quality of the solution?',
                        scale: 5,
                        required: true
                    },
                    {
                        id: 'communication',
                        type: 'rating',
                        question: 'How satisfied are you with the communication throughout the process?',
                        scale: 5,
                        required: true
                    },
                    {
                        id: 'additional_comments',
                        type: 'text',
                        question: 'Please provide any additional comments or suggestions:',
                        required: false
                    }
                ]),
                is_active: true
            };

            await this.makeRequest(`/table/${surveysTable.id}/record`, 'POST', {
                records: [{ fields: defaultSurvey }]
            });
            console.log('Default survey added');
        } catch (error) {
            console.log('Default survey creation failed:', error.message);
        }
    }

    async writeConfigToEnv() {
        console.log('Writing configuration to .env file...');
        
        if (!this.config.baseId) {
            console.log('No Base ID available to write to .env');
            console.log('Please manually add these lines to your .env file:');
            console.log(`TEABLE_BASE_ID=<your_base_id>`);
            console.log(`SETUP_COMPLETED=true`);
            return;
        }
        
        try {
            const envPath = '/app/.env';
            let envContent = '';
            
            if (fs.existsSync(envPath)) {
                envContent = fs.readFileSync(envPath, 'utf8');
            }
            
            if (!envContent.includes('TEABLE_BASE_ID=')) {
                envContent += `\nTEABLE_BASE_ID=${this.config.baseId}\n`;
            } else {
                envContent = envContent.replace(
                    /TEABLE_BASE_ID=.*/g, 
                    `TEABLE_BASE_ID=${this.config.baseId}`
                );
            }
            
            if (!envContent.includes('SETUP_COMPLETED=')) {
                envContent += `SETUP_COMPLETED=true\n`;
            } else {
                envContent = envContent.replace(
                    /SETUP_COMPLETED=.*/g, 
                    'SETUP_COMPLETED=true'
                );
            }
            
            fs.writeFileSync(envPath, envContent);
            console.log('Configuration written to .env file');
            
        } catch (error) {
            console.log(`Could not write to .env file: ${error.message}`);
            console.log('Please manually add these lines to your .env file:');
            console.log(`TEABLE_BASE_ID=${this.config.baseId}`);
            console.log(`SETUP_COMPLETED=true`);
        }
    }

    async run() {
        console.log('Starting OpenCSAT Teable Setup...\n');

        if (process.env.SETUP_COMPLETED === 'true') {
            console.log('Setup already completed, skipping...');
            console.log(`Using existing Base ID: ${process.env.TEABLE_BASE_ID}`);
            return;
        }

        if (!process.env.TEABLE_API_TOKEN) {
            console.error('TEABLE_API_TOKEN is required');
            console.error('Please obtain an API token from Teable and add it to your .env file');
            process.exit(1);
        }

        if (!await this.checkTeableConnection()) {
            process.exit(1);
        }

        if (!await this.findOrCreateSpace()) {
            process.exit(1);
        }

        if (!await this.findOrCreateBase()) {
            process.exit(1);
        }

        if (!await this.ensureTablesExist()) {
            process.exit(1);
        }

        await this.setupBasicFields();
        await this.cleanupUnusedDefaultFields();
        await this.cleanupAllEmptyRecords();
        await this.addDefaultData();
        await this.writeConfigToEnv();

        console.log('\nOpenCSAT Teable setup completed successfully!');
        
        if (this.config.baseId) {
            console.log(`Base ID: ${this.config.baseId}`);
        } else {
            console.log('Base ID not properly captured - manual configuration needed');
        }
        
        if (this.config.spaceId) {
            console.log(`Space ID: ${this.config.spaceId}`);
        }
        
        console.log('Ready to collect customer feedback!');
        
        console.log('\nConfiguration saved to .env file');
        console.log('Restart your application to load the new configuration');
        console.log('\nNext steps:');
        console.log('   1. Restart your OpenCSAT application: docker-compose restart app');
        console.log('   2. Test the survey system: http://localhost:8094/survey/test');
        console.log('   3. Add email templates to your PSA system');
        console.log('   4. View responses in Teable dashboard: http://localhost:8095');
    }
}

// Run the setup
if (require.main === module) {
    const setup = new TeableSetup();
    setup.run().catch(error => {
        console.error('\nSetup failed:', error.message);
        console.error('\nTroubleshooting tips:');
        console.error('   1. Ensure Teable is running and accessible');
        console.error('   2. Verify your TEABLE_API_TOKEN is correct');
        console.error('   3. Check network connectivity between containers');
        console.error('   4. Review Teable logs: docker logs opencsat_teable');
        process.exit(1);
    });
}

module.exports = TeableSetup;