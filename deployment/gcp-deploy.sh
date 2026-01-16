#!/bin/bash
set -e

# Configuration
PROJECT_ID="your-gcp-project-id"
REGION="us-central1"
IMAGE_NAME="magento-migration-api"
INSTANCE_NAME="magento-migration-vm"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Building Docker image...${NC}"
docker build -t gcr.io/${PROJECT_ID}/${IMAGE_NAME}:latest .

echo -e "${BLUE}Pushing to Google Container Registry...${NC}"
docker push gcr.io/${PROJECT_ID}/${IMAGE_NAME}:latest

echo -e "${BLUE}Deploying to GCP Compute Engine...${NC}"
gcloud compute instances update-container ${INSTANCE_NAME} \
  --zone=${REGION}-a \
  --container-image=gcr.io/${PROJECT_ID}/${IMAGE_NAME}:latest

echo -e "${GREEN}Deployment complete!${NC}"
