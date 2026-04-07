export STACK_NAME="openclaw-multitenancy"
export REGION="us-east-1"
export DYNAMODB_REGION="us-east-2"
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

export INSTANCE_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`InstanceId`].OutputValue' --output text)
export S3_BUCKET=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`TenantWorkspaceBucketName`].OutputValue' --output text)
