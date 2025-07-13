#!/usr/bin/env node

const https = require('https');
const http = require('http');

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

            if (data) {
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
            
            if (data) {
                req.write(JSON.stringify(data));
            }
            
            req.end();
        });
    }

    async checkTeableConnection() {
        console.log('🔍 Checking Teable connection...');
        try {
            await this.makeRequest('/ping');
            console.log('✅ Teable is accessible');
            return true;
        } catch (error) {
            console.error(`❌ Cannot connect to Teable: ${error.message}`);
            return false;
        }
    }

    async ensureSpaceExists() {
        console.log('🔍 Checking for OpenCSAT space...');
        try {
            const spaces = await this.makeRequest('/space');
            let opencsatSpace = spaces.find(space => space.name === 'OpenCSAT');
            
            if (!opencsatSpace) {
                console.log('📝 Creating OpenCSAT space...');
                opencsatSpace = await this.makeRequest('/space', 'POST', {
                    name: 'OpenCSAT'
                });
                console.log(`✅ Created OpenCSAT space: ${opencsatSpace.id}`);
            } else {
                console.log(`✅ Found OpenCSAT space: ${opencsatSpace.id}`);
            }
            
            this.config.spaceId = opencsatSpace.id;
            return true;
        } catch (error) {
            console.error(`❌ Error with space: ${error.message}`);
            return false;
        }
    }

    async ensureBaseExists() {
        console.log('🔍 Checking for OpenCSAT base...');
        try {
            const bases = await this.makeRequest(`/space/${this.config.spaceId}/base`);
            let opencsatBase = bases.find(base => base.name === 'OpenCSAT');
            
            if (!opencsatBase) {
                console.log('📝 Creating OpenCSAT base...');
                opencsatBase = await this.makeRequest('/base', 'POST', {
                    spaceId: this.config.spaceId,
                    name: 'OpenCSAT'
                });
                console.log(`✅ Created OpenCSAT base: ${opencsatBase.id}`);
            } else {
                console.log(`✅ Found OpenCSAT base: ${opencsatBase.id}`);
            }
            
            this.config.baseId = opencsatBase.id;
            return true;
        } catch (error) {
            console.error(`❌ Error with base: ${error.message}`);
            return false;
        }
    }

    async ensureTablesExist() {
        console.log('🔍 Checking and creating required tables...');
        try {
            const tables = await this.makeRequest(`/base/${this.config.baseId}/table`);
            const existingTables = tables.map(table => table.name);
            
            for (const tableName of this.requiredTables) {
                if (existingTables.includes(tableName)) {
                    console.log(`   ✅ Table '${tableName}' already exists`);
                } else {
                    console.log(`   📝 Creating table '${tableName}'...`);
                    await this.makeRequest(`/base/${this.config.baseId}/table`, 'POST', {
                        name: tableName,
                        description: `OpenCSAT ${tableName} table`
                    });
                    console.log(`   ✅ Created table '${tableName}'`);
                }
            }
            
            return true;
        } catch (error) {
            console.error(`❌ Error managing tables: ${error.message}`);
            return false;
        }
    }

    async setupBasicFields() {
        console.log('📝 Setting up basic table fields...');
        
        // Get table IDs
        const tables = await this.makeRequest(`/base/${this.config.baseId}/table`);
        const tableIds = {};
        tables.forEach(table => {
            tableIds[table.name] = table.id;
        });

        try {
            // Create basic fields for surveys table
            await this.makeRequest(`/table/${tableIds.surveys}/field`, 'POST', {
                name: 'title',
                type: 'singleLineText'
            });
            
            await this.makeRequest(`/table/${tableIds.surveys}/field`, 'POST', {
                name: 'questions',
                type: 'longText'
            });

            await this.makeRequest(`/table/${tableIds.surveys}/field`, 'POST', {
                name: 'is_active',
                type: 'checkbox'
            });

            // Create basic fields for tickets table
            await this.makeRequest(`/table/${tableIds.tickets}/field`, 'POST', {
                name: 'external_id',
                type: 'singleLineText'
            });

            await this.makeRequest(`/table/${tableIds.tickets}/field`, 'POST', {
                name: 'customer_email',
                type: 'email'
            });

            await this.makeRequest(`/table/${tableIds.tickets}/field`, 'POST', {
                name: 'customer_name',
                type: 'singleLineText'
            });

            // Create basic fields for survey_responses table
            await this.makeRequest(`/table/${tableIds.survey_responses}/field`, 'POST', {
                name: 'token',
                type: 'singleLineText'
            });

            await this.makeRequest(`/table/${tableIds.survey_responses}/field`, 'POST', {
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

            await this.makeRequest(`/table/${tableIds.survey_responses}/field`, 'POST', {
                name: 'responses',
                type: 'longText'
            });

            await this.makeRequest(`/table/${tableIds.survey_responses}/field`, 'POST', {
                name: 'overall_rating',
                type: 'number'
            });

            console.log('✅ Basic fields created');
        } catch (error) {
            console.log('⚠️  Some fields may already exist, continuing...');
        }
    }

    async addDefaultData() {
        console.log('📊 Adding default survey...');
        
        const tables = await this.makeRequest(`/base/${this.config.baseId}/table`);
        const surveysTable = tables.find(t => t.name === 'surveys');
        
        try {
            await this.makeRequest(`/table/${surveysTable.id}/record`, 'POST', {
                records: [{
                    fields: {
                        title: 'Customer Satisfaction Survey',
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
                                id: 'additional_comments',
                                type: 'text',
                                question: 'Please provide any additional comments:',
                                required: false
                            }
                        ]),
                        is_active: true
                    }
                }]
            });
            console.log('✅ Default survey added');
        } catch (error) {
            console.log('⚠️  Default survey may already exist');
        }
    }

    async run() {
        console.log('🚀 Starting OpenCSAT Teable Setup...\n');

        if (!process.env.TEABLE_API_TOKEN) {
            console.error('❌ TEABLE_API_TOKEN is required');
            process.exit(1);
        }

        if (!await this.checkTeableConnection()) {
            process.exit(1);
        }

        if (!await this.ensureSpaceExists()) {
            process.exit(1);
        }

        if (!await this.ensureBaseExists()) {
            process.exit(1);
        }

        if (!await this.ensureTablesExist()) {
            process.exit(1);
        }

        await this.setupBasicFields();
        await this.addDefaultData();

        console.log('\n✨ OpenCSAT Teable setup completed!');
        console.log(`📊 Base ID: ${this.config.baseId}`);
        console.log('🎉 Ready to collect customer feedback!');
        
        // Save base ID for the app to use
        console.log(`\n🔧 Add this to your .env file:`);
        console.log(`TEABLE_BASE_ID=${this.config.baseId}`);
    }
}

// Run the setup
if (require.main === module) {
    const setup = new TeableSetup();
    setup.run().catch(error => {
        console.error('\n💥 Setup failed:', error.message);
        process.exit(1);
    });
}
