#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${BLUE} $1${NC}"
}

print_success() {
    echo -e "${GREEN} $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}  $1${NC}"
}

print_error() {
    echo -e "${RED} $1${NC}"
}

print_info() {
    echo -e "${BLUE} $1${NC}"
}

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

# Validate required environment variables
validate_env_vars() {
    local missing_vars=()
    
    if [ -z "${POSTGRES_PASSWORD}" ]; then
        missing_vars+=("POSTGRES_PASSWORD")
    fi
    
    if [ ${#missing_vars[@]} -gt 0 ]; then
        print_error "Missing required environment variables:"
        for var in "${missing_vars[@]}"; do
            echo "  - $var"
        done
        print_info "Please update your .env file with the required values"
        exit 1
    fi
}

start_core_services() {
    print_status "Starting core services (Postgres + Teable)..."
    
    $DOCKER_COMPOSE pull postgres teable
    
    $DOCKER_COMPOSE up -d postgres teable
    
    print_info "Waiting for services to be healthy..."
    
    local postgres_ready=false
    local teable_ready=false
    local retries=60
    local count=0
    
    while [ $count -lt $retries ]; do
        if ! $postgres_ready && $DOCKER_COMPOSE ps postgres | grep -q "healthy"; then
            print_success "Postgres is healthy!"
            postgres_ready=true
        fi
        
        if ! $teable_ready; then
            if $DOCKER_COMPOSE ps teable | grep -q "Up" || $DOCKER_COMPOSE ps teable | grep -q "healthy"; then
                if curl -f -s "${TEABLE_URL}/" >/dev/null 2>&1; then
                    print_success "Teable is ready!"
                    teable_ready=true
                fi
            fi
        fi
        
        if $postgres_ready && $teable_ready; then
            break
        fi
        
        count=$((count + 1))
        echo -n "."
        sleep 2
    done
    
    if ! $postgres_ready || ! $teable_ready; then
        print_error "Services failed to start properly after $((retries * 2)) seconds"
        print_info "Check logs with:"
        echo "  $DOCKER_COMPOSE logs postgres"
        echo "  $DOCKER_COMPOSE logs teable"
        exit 1
    fi
    
    print_info "Giving Teable a moment to fully initialize..."
    sleep 10
}

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
    echo "  5. Give it a name like 'Auto Setup DB'"
    echo "  6. Select these permissions:"
    echo "     - Space: Create, Read, Update"
    echo "     - Base: Create, Read, Read all bases, Update"
    echo "     - Table: Create, Read, Update, Import data"
    echo "     - Field: Create, Read, Update, Delete"
    echo "     - Record: Create, Read, Update, Delete"
    echo "  7. Click 'Add all resources'"
    echo "  8. Copy the generated token"
    echo
        
    echo
    read -p "Enter your Teable API token: " TEABLE_API_TOKEN
    
    if [ -z "$TEABLE_API_TOKEN" ]; then
        print_error "API token cannot be empty"
        exit 1
    fi
    
    if grep -q "TEABLE_API_TOKEN=" .env; then
        sed -i "s|TEABLE_API_TOKEN=.*|TEABLE_API_TOKEN=$TEABLE_API_TOKEN|" .env
    else
        echo "TEABLE_API_TOKEN=$TEABLE_API_TOKEN" >> .env
    fi
    
    print_success "API token saved to .env"
}

test_api_token() {
    print_status "Testing API token..."
    
    local response
    response=$(curl -s -H "Authorization: Bearer $TEABLE_API_TOKEN" "${TEABLE_URL}/api/space" 2>/dev/null)
    
    if [ $? -ne 0 ] || [ -z "$response" ]; then
        print_error "Failed to connect to Teable API"
        print_info "Please check:"
        echo "  1. Teable is running at ${TEABLE_URL}"
        echo "  2. API token is correct"
        echo "  3. Token has required permissions"
        exit 1
    fi
    
    if echo "$response" | grep -q '"error"'; then
        print_error "API token validation failed"
        echo "Response: $response"
        exit 1
    fi
    
    print_success "API token is valid!"
}

# Run the setup process
run_setup() {
    print_status "Running OpenCSAT setup process..."
    
    export TEABLE_API_TOKEN
    export TEABLE_URL
    
    if command -v node >/dev/null 2>&1; then
        print_info "Using local Node.js"
        if [ -f "scripts/setup-teable.js" ]; then
            cd scripts
            
            node setup-teable.js
            local setup_result=$?
            cd ..
            
            if [ $setup_result -ne 0 ]; then
                print_error "Setup script failed"
                exit 1
            fi
        else
            print_error "Setup script not found at scripts/setup-teable.js"
            exit 1
        fi
    else
        print_info "Node.js not found locally, running setup in temporary container..."
        
        docker run --rm \
            --network opencsat_opencsat \
            -v "$(pwd)/scripts:/app" \
            -v "$(pwd)/.env:/app/.env" \
            -w /app \
            -e TEABLE_API_TOKEN="$TEABLE_API_TOKEN" \
            -e TEABLE_URL="http://teable:3000" \
            node:18-alpine \
            node setup-teable.js
        
        if [ $? -ne 0 ]; then
            print_error "Container setup failed"
            exit 1
        fi
    fi
    
    print_success "Setup process completed"
}

verify_setup() {
    print_status "Verifying setup completion..."
    
    local base_id=$(grep "TEABLE_BASE_ID=" .env 2>/dev/null | cut -d'=' -f2- || echo "")
    local setup_completed=$(grep "SETUP_COMPLETED=" .env 2>/dev/null | cut -d'=' -f2- || echo "")
    
    if [ -z "$base_id" ] || [ "$base_id" = "" ]; then
        print_warning "Base ID not found in .env, attempting to retrieve..."
        get_base_id_from_api
    fi
    
    if [ "$setup_completed" != "true" ]; then
        print_warning "Setup not marked as completed, updating..."
        if grep -q "SETUP_COMPLETED=" .env; then
            sed -i "s|SETUP_COMPLETED=.*|SETUP_COMPLETED=true|" .env
        else
            echo "SETUP_COMPLETED=true" >> .env
        fi
    fi
    
    print_success "Setup verification completed"
}

get_base_id_from_api() {
    print_info "🔄 Getting Base ID from Teable API..."
    
    if [ -z "$TEABLE_API_TOKEN" ]; then
        print_error "No API token available"
        return 1
    fi
    
    local space_response
    space_response=$(curl -s -H "Authorization: Bearer $TEABLE_API_TOKEN" "${TEABLE_URL}/api/space" 2>/dev/null)
    
    if [ $? -ne 0 ] || [ -z "$space_response" ]; then
        print_error "Failed to connect to Teable API"
        return 1
    fi
    
    local space_id
    space_id=$(echo "$space_response" | grep -o '"id":"[^"]*"[^}]*"name":"OpenCSAT"' | head -1 | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
    
    if [ -z "$space_id" ]; then
        print_warning "Could not find OpenCSAT space, trying first available space..."
        space_id=$(echo "$space_response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
        
        if [ -z "$space_id" ]; then
            print_error "No spaces found"
            return 1
        fi
    fi
    
    print_info "Using space: $space_id"
    
    local base_response
    base_response=$(curl -s -H "Authorization: Bearer $TEABLE_API_TOKEN" "${TEABLE_URL}/api/space/$space_id/base" 2>/dev/null)
    
    if [ $? -ne 0 ] || [ -z "$base_response" ]; then
        base_response=$(curl -s -H "Authorization: Bearer $TEABLE_API_TOKEN" "${TEABLE_URL}/api/base" 2>/dev/null)
    fi
    
    if [ $? -ne 0 ] || [ -z "$base_response" ]; then
        print_error "Failed to get bases"
        return 1
    fi
    
    local base_id
    base_id=$(echo "$base_response" | grep -o '"id":"[^"]*"[^}]*"name":"OpenCSAT"' | head -1 | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
    
    if [ -z "$base_id" ]; then
        print_warning "Could not find OpenCSAT base, trying first available base..."
        base_id=$(echo "$base_response" | grep -o '"id":"bse[^"]*"' | head -1 | cut -d'"' -f2)
        
        if [ -z "$base_id" ]; then
            print_error "No bases found"
            return 1
        fi
    fi
    
    if [[ "$base_id" =~ ^bse[A-Za-z0-9]{16}$ ]]; then
        print_success "Retrieved Base ID: $base_id"
        
        if grep -q "TEABLE_BASE_ID=" .env; then
            sed -i "s|TEABLE_BASE_ID=.*|TEABLE_BASE_ID=$base_id|" .env
        else
            echo "TEABLE_BASE_ID=$base_id" >> .env
        fi
        
        print_success "Base ID saved to .env"
        return 0
    else
        print_error "Invalid Base ID format: $base_id"
        return 1
    fi
}

start_application() {
    print_status "Building and starting OpenCSAT application..."
    
    print_info "Building application container with monitoring support..."
    $DOCKER_COMPOSE build app
    
    $DOCKER_COMPOSE up -d app
    
    print_info "Waiting for application to be ready..."
    local retries=30
    local count=0
    
    while [ $count -lt $retries ]; do
        if curl -f -s "${APP_URL}/health" >/dev/null 2>&1; then
            print_success "OpenCSAT application is running!"
            return 0
        fi
        
        count=$((count + 1))
        echo -n "."
        sleep 2
    done
    
    print_warning "Application may still be starting..."
    print_info "Check status with: $DOCKER_COMPOSE logs app"
}

test_system() {
    print_status "Testing the survey system with monitoring..."
    
    echo
    print_info "Testing health endpoint..."
    
    local health_response
    health_response=$(curl -s "${APP_URL}/health" 2>/dev/null)
    
    if [ $? -eq 0 ] && echo "$health_response" | grep -q '"status":"ok"'; then
        print_success "Health check passed!"
        
        # Show monitoring status
        local monitoring_enabled=$(echo "$health_response" | grep -o '"healthChecks"' | wc -l)
        if [ "$monitoring_enabled" -gt 0 ]; then
            print_success "Monitoring system is active!"
        fi
        
    else
        print_warning "Health check failed or returned warnings"
        echo "Response: $health_response"
    fi
    
    print_info "Testing survey endpoint..."
    
    if curl -f -s "${APP_URL}/survey/test" >/dev/null 2>&1; then
        print_success "Survey system is working!"
        echo
        print_info "OpenCSAT is ready to use!"
        echo
        print_info "Available endpoints:"
        echo "  • Test survey: ${APP_URL}/survey/test"
        echo "  • Database admin: ${TEABLE_URL}"
        echo "  • Health check: ${APP_URL}/health"
        echo "  • Metrics: ${APP_URL}/metrics"
        echo "  • Logs: $DOCKER_COMPOSE logs app"
        echo
        print_info "Monitoring features:"
        echo "  • Health monitoring with automatic checks"
        echo "  • Request/response metrics collection"
        echo "  • Structured logging with configurable levels"
        echo "  • Performance tracking and error monitoring"
        echo
        print_info "Next steps:"
        echo "  • Add PSA email templates from email-templates.txt"
        echo "  • Configure monitoring alerts (see /health and /metrics)"
        echo "  • Customize survey questions in Teable dashboard"
    else
        print_warning "Survey test failed. Check application logs:"
        echo "  $DOCKER_COMPOSE logs app"
        echo
        print_info "Common issues to check:"
        echo "  • Teable API token permissions"
        echo "  • Base ID configuration"
        echo "  • Network connectivity between services"
        echo "  • Application dependencies (express-rate-limit, axios)"
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
    echo "  rebuild   Rebuild and restart services"
    echo "  logs      Show application logs"
    echo "  status    Show service status"
    echo "  health    Check application health and metrics"
    echo "  clean     Stop services and remove data"
    echo "  help      Show this help"
    echo
    echo "Examples:"
    echo "  $0              # Run complete setup"
    echo "  $0 setup        # Run complete setup"
    echo "  $0 start        # Just start services"
    echo "  $0 rebuild      # Rebuild and restart after code changes"
    echo "  $0 logs app     # Show app logs"
    echo "  $0 status       # Check if services are running"
    echo "  $0 health       # Check application health and view metrics"
}

main_setup() {
    echo
    print_info "OpenCSAT Complete Setup"
    echo "============================="
    echo
    
    check_docker
    check_env_file
    detect_docker_compose
    load_config
    validate_env_vars
    start_core_services
    get_api_token
    test_api_token
    run_setup
    verify_setup
    start_application
    test_system
    
    echo
    print_success "Setup completed successfully!"
    echo
    print_info "Documentation:"
    echo "  • README.md - Full documentation"
    echo "  • email-templates.txt - PSA integration templates"
    echo "  • Check logs: $DOCKER_COMPOSE logs [service]"
    echo
    print_info "Useful commands:"
    echo "  • Restart: $0 restart"
    echo "  • Rebuild after changes: $0 rebuild"
    echo "  • View logs: $0 logs"
    echo "  • Check health: $0 health"
}


case "${1:-setup}" in
    "setup")
        main_setup
        ;;
    "start")
        detect_docker_compose
        load_config
        print_status "Starting all services..."
        $DOCKER_COMPOSE up -d
        print_success "Services started"
        print_info "Check status: $0 status"
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
    "rebuild")
        detect_docker_compose
        print_status "Rebuilding and restarting services..."
        $DOCKER_COMPOSE down
        $DOCKER_COMPOSE build
        $DOCKER_COMPOSE up -d
        print_success "Services rebuilt and restarted"
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
    "health")
        load_config
        print_status "Checking application health and metrics..."
        if command -v curl >/dev/null 2>&1; then
            echo
            print_info "=== Health Status ==="
            curl -s "${APP_URL:-http://localhost:8080}/health" | jq . 2>/dev/null || curl -s "${APP_URL:-http://localhost:8080}/health"
            echo
            print_info "=== Metrics Summary ==="
            curl -s "${APP_URL:-http://localhost:8080}/metrics" | jq '.metrics | keys' 2>/dev/null || echo "Metrics endpoint available at ${APP_URL:-http://localhost:8080}/metrics"
        else
            print_warning "curl not found, cannot check health endpoint"
            print_info "Install curl or check manually: ${APP_URL:-http://localhost:8080}/health"
        fi
        ;;
    "clean")
        detect_docker_compose
        print_warning "This will remove all data!"
        read -p "Are you sure? (y/N): " confirm
        if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
            $DOCKER_COMPOSE down -v
            docker image rm opencsat_app 2>/dev/null || true
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