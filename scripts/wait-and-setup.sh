#!/bin/bash

set -e

echo "🕐 Waiting for Teable to be ready..."

# Function to check if Teable is responding
check_teable() {
    # Just check if Teable port is responding, don't need specific endpoint
    curl -f -s "${TEABLE_URL:-http://teable:3000}/" >/dev/null 2>&1
}

# Wait for Teable to be ready (max 5 minutes)
timeout=300
elapsed=0
interval=10

while ! check_teable; do
    if [ $elapsed -ge $timeout ]; then
        echo "❌ Timeout waiting for Teable to be ready"
        exit 1
    fi
    
    echo "⏳ Teable not ready yet, waiting ${interval}s... (${elapsed}/${timeout}s)"
    sleep $interval
    elapsed=$((elapsed + interval))
done

echo "✅ Teable is ready!"
sleep 5

# Check if API token is provided
if [ -z "$TEABLE_API_TOKEN" ]; then
    echo "⚠️  No TEABLE_API_TOKEN provided."
    echo "📝 Quick setup required:"
    echo "   1. Open http://localhost:3000"
    echo "   2. Create account → User menu → API Tokens → Create"
    echo "   3. Add TEABLE_API_TOKEN=your_token to .env"
    echo "   4. Run: docker-compose up -d"
    echo ""
    echo "🎯 Everything else will be created automatically!"
    exit 0
fi

# Run the automated setup
echo "🚀 Running automated Teable setup..."

if node setup-teable.js; then
    echo "✨ Setup completed successfully!"
    echo "🎉 OpenCSAT is ready!"
else
    echo "❌ Setup failed!"
    exit 1
fi
