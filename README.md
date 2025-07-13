# OpenCSAT 📊

Simple, open-source Customer Satisfaction survey system for SyncroMSP.

## Quick Start

1. **Clone and setup:**
   ```bash
   git clone https://github.com/yourusername/opencsat.git
   cd opencsat
   cp .env.example .env
   # Edit .env with your settings
   ```

2. **Start everything:**
   ```bash
   docker-compose up -d
   ```

3. **Get Teable API token:**
   - Open http://localhost:3000
   - Create account → User menu → API Tokens → Create
   - Add `TEABLE_API_TOKEN=your_token` to `.env`
   - Run `docker-compose up -d` again

4. **You're ready!**
   - Survey app: http://localhost:8080
   - Admin GUI: http://localhost:3000

## How It Works

1. **SyncroMSP sends webhook** when ticket closes
2. **System creates survey** with unique token
3. **Email sent to customer** with survey link
4. **Customer fills survey** via simple web form  
5. **Data saved to Teable** and optionally back to SyncroMSP

## Configuration

Edit `.env` file:
- Set secure database password
- Add your SyncroMSP API credentials
- Configure your domain for production

## SyncroMSP Setup

1. **API Token:** Admin → API Tokens (needs read/write tickets)
2. **Webhook:** Admin → Webhooks → `http://your-domain/webhook/syncro`
3. **Custom Fields:** Create `csat_score`, `csat_comments`, `csat_response_date`

## Common Commands

```bash
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# View logs
docker-compose logs -f

# View logs for specific service
docker-compose logs -f app

# Restart everything
docker-compose down && docker-compose up -d

# Clean up everything
docker-compose down -v
```

## Production Deployment

Use Caddy or nginx to reverse proxy port 8080 with SSL.

## License

MIT License - see LICENSE file
