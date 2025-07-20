# OpenCSAT 📊

**Universal Customer Satisfaction Survey System**

Simple, email template-driven CSAT surveys that work with **any PSA system** - SyncroMSP, ConnectWise, Autotask, Kaseya, and more!

## 🎯 How It Works

1. **Add email template** to your PSA system's "ticket closed" notification
2. **Template calls OpenCSAT API** to create survey with ticket details
3. **Customer gets redirected** to beautiful survey page with their ticket context
4. **Responses saved** to Teable database for analysis
5. **Optional integrations** sync data back to your PSA system

## ⚡ Quick Start

### 1. Deploy OpenCSAT
```bash
git clone https://github.com/yourusername/opencsat.git
cd opencsat
cp .env.example .env
# Edit .env with your settings
docker-compose up -d
```

### 2. Get Teable API Token
- Open http://localhost:3000 (Teable interface)
- Create account → User menu → Personal Access Tokens → Create
- Add `TEABLE_API_TOKEN=your_token` to `.env`
- Run `docker-compose up -d` again


### 3. Add Email Template to Your PSA
1. Choose your PSA system template from `/email-templates.txt`
2. **Replace `{{OPENCSAT_BASE_URL}}`** with your actual domain (e.g., `https://csat.yourcompany.com`)
3. Add the template to your PSA's "ticket closed" email notification
4. Test with a sample ticket closure



### 4. Test It!
- Visit `http://localhost:8080/survey/test` to see the survey interface
- Close a test ticket in your PSA to verify the email integration

## 🌟 Key Features

### Universal Compatibility
- **Works with ANY PSA** that supports email templates
- **No complex integrations** required to get started
- **Rich ticket context** displayed in surveys

### Beautiful Survey Experience
- **Mobile-responsive** design
- **Ticket details** shown to customers
- **Multiple question types** (ratings, text feedback)
- **Professional branding** options

### Powerful Analytics
- **Teable dashboard** for viewing responses
- **Average ratings** and response rates
- **Export capabilities** for reporting
- **API access** for custom integrations

### Optional PSA Sync
- **Modular integrations** for syncing results back to PSA
- **Custom field updates** (CSAT scores, comments)
- **Webhook support** for real-time sync

## 🏗️ Architecture

```
PSA System → Email Template → OpenCSAT API → Survey Page → Teable Database
                                ↓
                        Optional PSA Integration
```

### Core Components
- **Node.js API** - Survey creation and management
- **Teable Database** - No-code data management and analytics
- **PostgreSQL** - Reliable data storage
- **Docker** - Easy deployment and scaling

## 📊 Data Structure

### Survey Response Fields
- **Ticket Context**: ID, subject, technician, completion date
- **Customer Info**: Name, email, company
- **Survey Data**: Ratings, comments, submission timestamp
- **Custom Fields**: Any additional PSA-specific data

### Default Survey Questions
1. **Overall Satisfaction** (1-5 rating)
2. **Response Time** (1-5 rating) 
3. **Technical Quality** (1-5 rating)
4. **Communication** (1-5 rating)
5. **Additional Comments** (open text)

## 🔧 Configuration

### Environment Variables
```bash
# Database
POSTGRES_DB=opencsat
POSTGRES_USER=opencsat
POSTGRES_PASSWORD=your_secure_password

# Teable
SECRET_KEY=your_32_character_secret_key_here
PRISMA_DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
PUBLIC_ORIGIN=https://csat.yourcompany.com

# Teable API (add after setup)
TEABLE_API_TOKEN=your_api_token_here

# App Config
SURVEY_EXPIRY_DAYS=30
```

### Custom Branding
- Edit `/app/views/survey.html` for custom styling
- Modify survey questions in Teable interface
- Add company logos and colors

## 🚀 Production Deployment

### 1. DNS and SSL
```bash
# Point your domain to the server
csat.yourcompany.com → YOUR_SERVER_IP

# Use Caddy for automatic SSL
docker run -d \
  -p 80:80 -p 443:443 \
  -v caddy_data:/data \
  caddy:alpine \
  caddy reverse-proxy \
  --from csat.yourcompany.com \
  --to localhost:8080
```

### 2. Update Environment
```bash
# Update .env for production
PUBLIC_ORIGIN=https://csat.yourcompany.com
POSTGRES_PASSWORD=strong_production_password
SECRET_KEY=your_production_secret_key
```

### 3. Backup Strategy
```bash
# Database backups
docker exec opencsat_postgres pg_dump -U opencsat opencsat > backup.sql

# Automated daily backups
0 2 * * * docker exec opencsat_postgres pg_dump -U opencsat opencsat | gzip > /backups/opencsat-$(date +\%Y\%m\%d).sql.gz
```

## 📈 Analytics & Reporting

### Teable Dashboard
- **Visual charts** of satisfaction ratings
- **Response tracking** and completion rates  
- **Comment analysis** and feedback trends
- **Export options** (CSV, Excel, PDF)

### API Endpoints
```bash
# Get survey statistics
GET /api/stats

# Create survey programmatically  
POST /api/survey/create

# Webhook for real-time updates
POST /webhook/survey-completed
```

## 🔌 PSA Integrations

### Available Integrations
- **SyncroMSP** - Custom field updates, ticket comments
- **ConnectWise** - Custom fields, activity entries
- **Autotask** - UDFs, ticket notes
- **Generic Webhook** - For custom integrations

###
