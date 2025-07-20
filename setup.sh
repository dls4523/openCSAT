#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}🔧 $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}📋 $1${NC}"
}

# Function to detect docker compose command
detect_docker_compose() {
    if command -v docker-compose >/dev/null 2>&1; then
        DOCKER_COMPOSE="docker-compose"
    elif docker compose version >/dev/null 2>&1; then
        DOCKER_COMPOSE="docker compose"
    else
        print_error "Neither 'docker-compose' nor 'docker compose' found"
        print_info "Please install Docker Compose: https://docs.docker.com/compose/install/"
        exit 1
    fi
    print_info "Using: $DOCKER_COMPOSE"
}

# Function to load configuration from .env file
load_config() {
    if [ -f .env ]; then
        # Source the .env file to get variables
        set -a  # automatically export all variables
        source .env
        set +a  # stop auto-exporting
        
        # Set defaults if not specified in .env
        TEABLE_PORT=${TEABLE_PORT:-3000}
        APP_PORT=${APP_PORT:-8080}
        POSTGRES_PORT=${POSTGRES_PORT:-5432}
        
        # Build URLs
        TEABLE_URL="http://localhost:${TEABLE_PORT}"
        APP_URL="http://localhost:${APP_PORT}"
        
        print_info "Loaded configuration from .env"
        print_info "Teable: ${TEABLE_URL}, App: ${APP_URL}"
    else
        # Use defaults if no .env file
        TEABLE_PORT=3000
        APP_PORT=8080
        POSTGRES_PORT=5432
        TEABLE_URL="http://localhost:${TEABLE_PORT}"
        APP_URL="http://localhost:${APP_PORT}"
        
        print_warning "No .env file found, using default ports"
    fi
}

# Check if Docker is running
check_docker() {
    if ! docker info >/dev/null 2>&1; then
        print_error "Docker is not running. Please start Docker and try again."
        exit 1
    fi
    print_success "Docker is running"
}

# Check if .env file exists
check_env_file() {
    if [ ! -f .env ]; then
        print_warning ".env file not found. Creating from template..."
        if [ -f .env.example ]; then
            cp .env.example .env
            print_success "Created .env from .env.example"
            print_warning "Please edit .env file and set your POSTGRES_PASSWORD"
            echo
            read -p "Press Enter when you've configured .env file..."
        else
            print_error ".env.example not found. Please create .env file manually."
            exit 1
        fi
    fi
    print_success ".env file exists"
}

# Start core services (postgres, teable)
start_core_services() {
    print_status "Starting core services (Postgres + Teable)..."
    
    # Start just postgres and teable
    $DOCKER_COMPOSE up -d postgres teable
    
    print_info "Waiting for Teable to be ready at ${TEABLE_URL}..."
    
    # Wait for Teable to be accessible
    local retries=30
    local count=0
    
    while [ $count -lt $retries ]; do
        if curl -f -s "${TEABLE_URL}/" >/dev/null 2>&1; then
            print_success "Teable is ready!"
            return 0
        fi
        
        count=$((count + 1))
        echo -n "."
        sleep 2
    done
    
    print_error "Teable failed to start after $((retries * 2)) seconds"
    print_info "Check logs with: $DOCKER_COMPOSE logs teable"
    exit 1
}

# Get API token from user
get_api_token() {
    local current_token=$(grep "TEABLE_API_TOKEN=" .env 2>/dev/null | cut -d'=' -f2- || echo "")
    
    if [ -n "$current_token" ] && [ "$current_token" != "" ]; then
        print_info "Found existing API token in .env"
        read -p "Use existing token? (y/n): " use_existing
        if [ "$use_existing" = "y" ] || [ "$use_existing" = "Y" ]; then
            TEABLE_API_TOKEN="$current_token"
            return 0
        fi
    fi
    
    print_info "To get your Teable API token:"
    echo "  1. Open ${TEABLE_URL} in your browser"
    echo "  2. Create an account (first user becomes admin)"
    echo "  3. Go to User Menu → Personal Access Tokens"
    echo "  4. Click 'Create Token'"
    echo "  5. Select these permissions:"
    echo "     - Space: Create, Read, Update"
    echo "     - Base: Create, Read, Read all bases, Update"
    echo "     - Table: Create, Read, Update, Import data"
    echo "     - Field: Create, Read, Update, Delete"
    echo "     - Record: Create, Read, Update, Delete"
    echo "     (Or just click 'Add all resources')"
    echo "  6. Copy the generated token"
    echo
    
    # Open browser automatically if possible
    if command -v xdg-open >/dev/null 2>&1; then
        read -p "Open browser automatically? (y/n): " open_browser
        if [ "$open_browser" = "y" ] || [ "$open_browser" = "Y" ]; then
            xdg-open "${TEABLE_URL}" >/dev/null 2>&1 &
        fi
    elif command -v open >/dev/null 2>&1; then
        read -p "Open browser automatically? (y/n): " open_browser
        if [ "$open_browser" = "y" ] || [ "$open_browser" = "Y" ]; then
            open "${TEABLE_URL}" >/dev/null 2>&1 &
        fi
    fi
    
    echo
    read -p "Enter your Teable API token: " TEABLE_API_TOKEN
    
    if [ -z "$TEABLE_API_TOKEN" ]; then
        print_error "API token cannot be empty"
        exit 1
    fi
    
    # Update .env file - use | as delimiter to avoid issues with / and = in token
    if grep -q "TEABLE_API_TOKEN=" .env; then
        sed -i "s|TEABLE_API_TOKEN=.*|TEABLE_API_TOKEN=$TEABLE_API_TOKEN|" .env
    else
        echo "TEABLE_API_TOKEN=$TEABLE_API_TOKEN" >> .env
    fi
    
    print_success "API token saved to .env"
}

# Extract Base ID from Teable API as fallback
get_base_id_from_api() {
    print_info "🔄 Getting Base ID from Teable API..."
    
    if [ -z "$TEABLE_API_TOKEN" ]; then
        print_error "No API token available"
        return 1
    fi
    
    # Get OpenCSAT space
    local space_response
    space_response=$(curl -s -H "Authorization: Bearer $TEABLE_API_TOKEN" "${TEABLE_URL}/api/space" 2>/dev/null)
    
    if [ $? -ne 0 ] || [ -z "$space_response" ]; then
        print_error "Failed to connect to Teable API"
        return 1
    fi
    
    # Extract OpenCSAT space ID
    local space_id
    space_id=$(echo "$space_response" | grep -o '"id":"[^"]*"[^}]*"name":"OpenCSAT"' | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
    
    if [ -z "$space_id" ]; then
        print_error "Could not find OpenCSAT space"
        return 1
    fi
    
    print_info "Found OpenCSAT space: $space_id"
    
    # Get bases in the OpenCSAT space
    local base_response
    base_response=$(curl -s -H "Authorization: Bearer $TEABLE_API_TOKEN" "${TEABLE_URL}/api/space/$space_id/base" 2>/dev/null)
    
    if [ $? -ne 0 ] || [ -z "$base_response" ]; then
        print_error "Failed to get bases from space"
        return 1
    fi
    
    # Extract OpenCSAT base ID
    local base_id
    base_id=$(echo "$base_response" | grep -o '"id":"[^"]*"[^}]*"name":"OpenCSAT"' | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
    
    if [ -z "$base_id" ]; then
        print_error "Could not find OpenCSAT base in space"
        return 1
    fi
    
    # Validate and save the base ID
    if [[ "$base_id" =~ ^bse[A-Za-z0-9]{16}$ ]]; then
        print_success "✅ Retrieved Base ID from API: $base_id"
        
        # Write to .env
        if grep -q "TEABLE_BASE_ID=" .env; then
            sed -i "s|TEABLE_BASE_ID=.*|TEABLE_BASE_ID=$base_id|" .env
        else
            echo "TEABLE_BASE_ID=$base_id" >> .env
        fi
        
        if grep -q "SETUP_COMPLETED=" .env; then
            sed -i "s|SETUP_COMPLETED=.*|SETUP_COMPLETED=true|" .env
        else
            echo "SETUP_COMPLETED=true" >> .env
        fi
        
        print_success "✅ Base ID saved to .env"
        return 0
    else
        print_error "Invalid Base ID format from API: $base_id"
        return 1
    fi
}

# Run the setup process
run_setup() {
    print_status "Running OpenCSAT setup process..."
    
    # Export the token for the setup process
    export TEABLE_API_TOKEN
    export TEABLE_URL
    
    # Check if node is available locally
    if command -v node >/dev/null 2>&1; then
        print_info "Using local Node.js"
        if [ -f "scripts/setup-teable.js" ]; then
            cd scripts
            node setup-teable.js
            cd ..
        else
            print_error "Setup script not found at scripts/setup-teable.js"
            exit 1
        fi
    else
        print_info "Node.js not found locally, running setup in Docker container..."
        
        # Run setup in Docker container
        docker run --rm \
            --network opencsat_opencsat \
            -v "$(pwd)/scripts:/app" \
            -w /app \
            -e TEABLE_API_TOKEN="$TEABLE_API_TOKEN" \
            -e TEABLE_URL="http://teable:3000" \
            node:18-alpine \
            node setup-teable.js
        
        print_info "Setup script completed"
    fi
    
    # Get Base ID from API since the script output is unreliable
    if get_base_id_from_api; then
        print_success "✅ Setup completed successfully"
    else
        print_error "❌ Could not retrieve Base ID"
        print_info "Manual steps required:"
        echo "  1. Open ${TEABLE_URL} in your browser"
        echo "  2. Click on the OpenCSAT base"
        echo "  3. Copy the Base ID from the URL (bseXXXXXXXXXXXXXXX)"
        echo "  4. Add it to .env: echo 'TEABLE_BASE_ID=your_base_id' >> .env"
        echo "  5. Run: echo 'SETUP_COMPLETED=true' >> .env"
        exit 1
    fi
}

# Start the application
start_application() {
    print_status "Starting OpenCSAT application..."
    
    # Start the app container
    $DOCKER_COMPOSE up -d app
    
    # Wait a moment for app to start
    sleep 3
    
    # Test the application
    if curl -f -s "${APP_URL}/health" >/dev/null 2>&1; then
        print_success "OpenCSAT application is running!"
    else
        print_warning "Application may still be starting..."
        print_info "Check status with: $DOCKER_COMPOSE logs app"
    fi
}

# Test the system
test_system() {
    print_status "Testing the survey system..."
    
    echo
    print_info "Testing survey endpoint..."
    
    if curl -f -s "${APP_URL}/survey/test" >/dev/null 2>&1; then
        print_success "Survey system is working!"
        echo
        print_info "🎉 OpenCSAT is ready to use!"
        echo
        print_info "Next steps:"
        echo "  • Test survey: ${APP_URL}/survey/test"
        echo "  • View database: ${TEABLE_URL}"
        echo "  • Check health: ${APP_URL}/health"
        echo "  • Add PSA email templates from email-templates.txt"
    else
        print_warning "Survey test failed. Check application logs:"
        echo "  $DOCKER_COMPOSE logs app"
    fi
}

# Show help
show_help() {
    echo "OpenCSAT Setup Script"
    echo
    echo "Usage: $0 [command]"
    echo
    echo "Commands:"
    echo "  setup     Run complete setup process (default)"
    echo "  start     Start services only (no setup)"
    echo "  stop      Stop all services"
    echo "  restart   Restart all services"
    echo "  logs      Show application logs"
    echo "  status    Show service status"
    echo "  clean     Stop services and remove data"
    echo "  help      Show this help"
    echo
    echo "Examples:"
    echo "  $0              # Run complete setup"
    echo "  $0 setup        # Run complete setup"
    echo "  $0 start        # Just start services"
    echo "  $0 logs app     # Show app logs"
    echo "  $0 status       # Check if services are running"
}

# Main setup process
main_setup() {
    echo
    print_info "🚀 OpenCSAT Manual Setup"
    echo "=========================="
    echo
    
    check_docker
    check_env_file
    detect_docker_compose
    load_config
    start_core_services
    get_api_token
    run_setup
    start_application
    test_system
    
    echo
    print_success "🎉 Setup completed successfully!"
}

# Handle commands
case "${1:-setup}" in
    "setup")
        main_setup
        ;;
    "start")
        detect_docker_compose
        print_status "Starting all services..."
        $DOCKER_COMPOSE up -d postgres teable app
        print_success "Services started"
        ;;
    "stop")
        detect_docker_compose
        print_status "Stopping all services..."
        $DOCKER_COMPOSE down
        print_success "Services stopped"
        ;;
    "restart")
        detect_docker_compose
        print_status "Restarting all services..."
        $DOCKER_COMPOSE restart
        print_success "Services restarted"
        ;;
    "logs")
        detect_docker_compose
        if [ -n "$2" ]; then
            $DOCKER_COMPOSE logs -f "$2"
        else
            $DOCKER_COMPOSE logs -f
        fi
        ;;
    "status")
        detect_docker_compose
        $DOCKER_COMPOSE ps
        ;;
    "clean")
        detect_docker_compose
        print_warning "This will remove all data!"
        read -p "Are you sure? (y/N): " confirm
        if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
            $DOCKER_COMPOSE down -v
            print_success "All data removed"
        else
            print_info "Clean cancelled"
        fi
        ;;
    "help"|"-h"|"--help")
        show_help
        ;;
    *)
        print_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac