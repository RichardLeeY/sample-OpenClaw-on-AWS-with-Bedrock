#!/bin/bash
# Deploy OpenClaw Admin Console on EC2 (run via SSM RunShellScript)
set -ex

TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
REGION=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/region)
S3_BUCKET="$1"

# Create Python venv and install dependencies
python3 -m venv /opt/admin-venv
/opt/admin-venv/bin/pip install fastapi uvicorn boto3 requests python-multipart anthropic

# Download and extract admin console
aws s3 cp "s3://${S3_BUCKET}/_deploy/admin-deploy.tar.gz" /tmp/admin-deploy.tar.gz --region "$REGION"
mkdir -p /opt/admin-console
tar xzf /tmp/admin-deploy.tar.gz -C /opt/admin-console

chown -R ubuntu:ubuntu /opt/admin-console /opt/admin-venv

# Install systemd service
cat > /etc/systemd/system/openclaw-admin.service << 'EOF'
[Unit]
Description=OpenClaw Admin Console
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/admin-console/server
EnvironmentFile=-/etc/openclaw/env
ExecStart=/opt/admin-venv/bin/python main.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable openclaw-admin
systemctl start openclaw-admin
