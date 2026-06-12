#!/bin/bash

# ============================================
# Lead Scraper - AWS EC2 Deployment Script
# Run this on your EC2 instance
# ============================================

set -e

echo "=========================================="
echo "  Lead Scraper Deployment Script"
echo "=========================================="

# Step 1: Update system
echo "[1/7] Updating system..."
sudo apt update && sudo apt upgrade -y

# Step 2: Install Docker (if not installed)
echo "[2/7] Checking Docker..."
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    sudo apt install docker.io -y
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo usermod -aG docker $USER
    echo "Docker installed. You may need to log out and back in."
else
    echo "Docker already installed."
fi

# Step 3: Install Docker Compose
echo "[3/7] Checking Docker Compose..."
if ! command -v docker-compose &> /dev/null; then
    echo "Installing Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
else
    echo "Docker Compose already installed."
fi

# Step 4: Clone or update repo
echo "[4/7] Setting up project..."
if [ -d ~/scrapper ]; then
    echo "Project exists. Pulling latest..."
    cd ~/scrapper
    git pull origin main
else
    echo "Cloning repository..."
    # REPLACE with your actual repo URL
    git clone https://github.com/YOUR_USERNAME/scrapper.git ~/scrapper
    cd ~/scrapper
fi

# Step 5: Create .env file
echo "[5/7] Creating .env file..."
cat > .env << 'EOF'
PORT=5000
GOOGLE_CLIENT_ID=359359481405-cbuspr0m3klfs7grkbd6pba5vf4ij24f.apps.googleusercontent.com
PROXY_LIST=
EOF
echo ".env file created."

# Step 6: Stop old containers
echo "[6/7] Cleaning up old containers..."
docker stop lead-scraper || true
docker rm lead-scraper || true
docker rmi lead-scraper:latest || true

# Step 7: Build and run
echo "[7/7] Building and starting containers..."

# Build the app image
docker build -t lead-scraper:latest .

# Start the app
docker run -d \
  --name lead-scraper \
  --restart always \
  -p 5000:5000 \
  --env-file .env \
  lead-scraper:latest

# Verify
echo ""
echo "=========================================="
echo "  Deployment Complete!"
echo "=========================================="
echo ""
echo "Checking containers..."
docker ps

echo ""
echo "Testing health endpoint..."
sleep 3
curl -s http://localhost:5000/health || echo "App may still be starting..."

echo ""
echo "=========================================="
echo "  Done! App should be running on port 5000"
echo "=========================================="
