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
            'survey_responses', // Enhanced with ticket context
            'companies',        // NEW: Multi-tenant support
            'integrations',     // NEW: PSA integration configs
            'email_templates',  // Enhanced for different PSAs
            'webhook_logs',
            'system_config'
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
                headers
