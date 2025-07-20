# OpenCSAT

**Universal Customer Satisfaction Survey System**

Simple, email template-driven CSAT surveys that work with **any PSA system** - SyncroMSP, ConnectWise, Autotask, Kaseya, and more!

## How It Works

1. Add email template to your PSA system's "ticket closed" notification
2. Template calls OpenCSAT API to create survey with ticket details
3. Customer gets redirected to survey page with their ticket context
4. Responses saved to Teable database for analysis
5. Optional integrations sync data back to your PSA system

## Quick Start

### Prerequisites
- Docker 20.10+ and Docker Compose 2.0+
- Domain name pointing to your server (for production)

### Deploy
```bash
git clone https://github.com/yourusername/opencsat.git
cd opencsat
cp .env.example .env
# Edit .env - set POSTGRES_PASSWORD at minimum
chmod +x setup.sh
./setup.sh
```

### Access
- **Survey System**: http://localhost:8080
- **Database Admin**: http://localhost:3000
- **Test Survey**: http://localhost:8080/survey/test
- **Health Check**: http://localhost:8080/health

## Configuration

### Basic .env Settings
```bash
TEABLE_PORT=3000
APP_PORT=8080
POSTGRES_PASSWORD=your_secure_password
PUBLIC_ORIGIN=https://csat.yourcompany.com  # For production
```

### Management Commands
```bash
./setup.sh              # Complete setup
./setup.sh start         # Start services
./setup.sh stop          # Stop services
./setup.sh restart       # Restart services
./setup.sh logs [app]    # View logs
./setup.sh health        # Check system health
```

## Key Features

- **Universal PSA compatibility** - Works with any system that supports email templates
- **Mobile-responsive surveys** with modern UI
- **Real-time monitoring** via `/health` and `/metrics` endpoints
- **Rate limiting** and security protections
- **Comprehensive analytics** in Teable dashboard
- **Export capabilities** (CSV, Excel, PDF)

## PSA Integration

1. Choose your PSA template from `email-templates.txt`
2. Replace `https://your-opencsat-domain.com` with your actual domain
3. Add template to your PSA's "ticket closed" email
4. Test with a sample ticket

### Survey URL Format
```
https://csat.yourcompany.com/survey/create-and-redirect?
  ticket_id=VALUE&
  customer_email=VALUE&
  customer_name=VALUE&
  ticket_subject=VALUE&
  technician_name=VALUE&
  company_name=VALUE
```

## Production Deployment

### SSL Setup with Caddy
```bash
docker run -d -p 80:80 -p 443:443 -v caddy_data:/data caddy:alpine \
  caddy reverse-proxy --from csat.yourcompany.com --to localhost:8080
```

### Production Environment
```bash
PUBLIC_ORIGIN=https://csat.yourcompany.com
POSTGRES_PASSWORD=strong_production_password
NODE_ENV=production
LOG_LEVEL=warn
ENABLE_MONITORING=true
```

## Troubleshooting

### Common Issues
```bash
# Check service status
./setup.sh status

# View application health
curl http://localhost:8080/health

# Check logs
./setup.sh logs app

# Verify Teable connection
curl http://localhost:3000/
```

### API Token Issues
Ensure your Teable API token has these permissions:
- Space: Create, Read, Update
- Base: Create, Read, Update
- Table: Create, Read, Update, Import data
- Field: Create, Read, Update, Delete
- Record: Create, Read, Update, Delete

## Development

```bash
# Start development environment
./setup.sh start

# Rebuild after code changes
./setup.sh rebuild

# Monitor logs
./setup.sh logs app
```

## Support

- **Documentation**: Check `email-templates.txt` for PSA integration
- **Issues**: Create GitHub issue with `./setup.sh health` output
- **Monitoring**: Use `/health` and `/metrics` endpoints

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Made for MSPs who care about customer satisfaction**