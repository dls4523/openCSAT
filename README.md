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

### Prerequisites
- Docker 20.10+ and Docker Compose 2.0+
- Node.js 16+ (for setup script)
- Domain name pointing to your server (for production)

### 1. Deploy OpenCSAT
```bash
git clone https://github.com/yourusername/opencsat.git
cd opencsat

# Copy and configure environment
cp .env.example .env
# Edit .env - set POSTGRES_PASSWORD at minimum

# Run setup with live output
chmod +x setup.sh
./setup.sh
```

### 2. Setup Process
The setup script will:
1. **Start services** (Postgres + Teable)
2. **Guide you** to create a Teable API token
3. **Automatically create** database schema and default survey
4. **Test the system** and provide next steps

### 3. Access Your System
- **Survey System**: http://localhost:8080
- **Database Admin**: http://localhost:3000
- **Test Survey**: http://localhost:8080/survey/test

## 🔧 Configuration

### Port Configuration
Default ports in `.env`:
```bash
TEABLE_PORT=3000    # Database admin interface
APP_PORT=8080       # Survey system
POSTGRES_PORT=5432  # Database
```

### Production Configuration
```bash
# Required for production
PUBLIC_ORIGIN=https://csat.yourcompany.com
POSTGRES_PASSWORD=secure_production_password
SECRET_KEY=your_32_character_secret_key_here

# Optional: Custom ports
APP_PORT=80
TEABLE_PORT=3001
```

## 🛠️ Setup Commands

```bash
./setup.sh              # Complete setup process
./setup.sh start         # Start services only
./setup.sh stop          # Stop all services
./setup.sh restart       # Restart services
./setup.sh logs [app]    # View logs
./setup.sh status        # Check service status
./setup.sh clean         # Remove all data
./setup.sh help          # Show all commands
```

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
APP_PORT=8080  # Or 80 if not using reverse proxy
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

# Health check
GET /health
```

## 🔌 PSA Integration

### Email Template Setup
1. **Choose your PSA** from the templates in `email-templates.txt`
2. **Replace the domain** in the template:
   ```
   Change: https://your-opencsat-domain.com
   To: https://csat.yourcompany.com
   ```
3. **Add to your PSA** as a "ticket closed" email template
4. **Test** with a sample ticket

### Available PSA Templates
- **SyncroMSP** - Complete template with merge fields
- **ConnectWise Manage** - Service ticket integration
- **Autotask PSA** - Workflow rule template
- **Kaseya VSA** - Service desk configuration
- **Generic Webhook** - For custom integrations

## 🔧 Troubleshooting

### Common Issues

**Setup fails to connect to Teable:**
```bash
# Check if Teable is running
./setup.sh status
./setup.sh logs teable

# Verify port availability
netstat -tlnp | grep :3000
```

**Survey returns "not configured" error:**
```bash
# Check app configuration
curl http://localhost:8080/health
./setup.sh logs app

# Verify environment variables
grep TEABLE_ .env
```

**API token permission errors:**
- Ensure token has all required permissions:
  - Space: Create, Read, Update
  - Base: Create, Read, Update, Read all bases
  - Table: Create, Read, Update, Import data
  - Field: Create, Read, Update, Delete
  - Record: Create, Read, Update, Delete

### Port Conflicts
If default ports are in use:
```bash
# Check what's using the port
sudo lsof -i :8080

# Use different ports in .env
APP_PORT=8081
TEABLE_PORT=3001

# Restart services
./setup.sh restart
```

### Database Issues
```bash
# Reset database (removes all data)
./setup.sh clean
./setup.sh

# Manual database access
docker exec -it opencsat_postgres psql -U opencsat -d opencsat
```

## 📝 Development

### Local Development
```bash
# Start development environment
./setup.sh start

# Watch application logs
./setup.sh logs app

# Access database directly
./setup.sh logs postgres
```

### Making Changes
```bash
# After code changes, rebuild
docker-compose build app
./setup.sh restart
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with `./setup.sh`
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: Check this README and `email-templates.txt`
- **Issues**: Create a GitHub issue
- **Discussions**: Use GitHub Discussions for questions

---

**Made with ❤️ for MSPs who care about customer satisfaction**