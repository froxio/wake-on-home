#!/usr/bin/env bash
# Deploys the minimal OAuth2 server Lambda for Google Smart Home account linking.
# Usage: ./deploy.sh <aws-account-id> <client-id> <client-secret> <oauth-token>
#
# After deploying, set these in the Actions on Google console account linking:
#   Authorization URL: https://<api-id>.execute-api.us-east-1.amazonaws.com/auth
#   Token URL:         https://<api-id>.execute-api.us-east-1.amazonaws.com/token

set -euo pipefail

ACCOUNT_ID="${1:?Usage: ./deploy.sh <aws-account-id> <client-id> <client-secret> <oauth-token>}"
CLIENT_ID="${2:?client-id required}"
CLIENT_SECRET="${3:?client-secret required}"
OAUTH_TOKEN="${4:?oauth-token required}"

FUNCTION_NAME="wake-on-home-oauth"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/lambda-basic-execution"

echo "==> Zipping function"
zip -r function.zip index.js package.json

ENV_VARS="Variables={OAUTH_CLIENT_ID=${CLIENT_ID},OAUTH_CLIENT_SECRET=${CLIENT_SECRET},OAUTH_TOKEN=${OAUTH_TOKEN}}"

if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" &>/dev/null; then
  echo "==> Updating existing function"
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file fileb://function.zip \
    --region "$REGION"

  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --environment "$ENV_VARS" \
    --region "$REGION"
else
  echo "==> Creating function (first deploy)"
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime nodejs20.x \
    --handler index.handler \
    --zip-file fileb://function.zip \
    --role "$ROLE_ARN" \
    --region "$REGION"

  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --environment "$ENV_VARS" \
    --region "$REGION"

  echo "==> Creating API Gateway"
  API_ID=$(aws apigatewayv2 create-api \
    --name "$FUNCTION_NAME" \
    --protocol-type HTTP \
    --target "arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME}" \
    --region "$REGION" \
    --query 'ApiId' --output text)

  aws lambda add-permission \
    --function-name "$FUNCTION_NAME" \
    --statement-id apigw-invoke \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --region "$REGION"

  echo ""
  echo "==> OAuth endpoints — use these in the Actions on Google console:"
  echo "    Authorization URL: https://${API_ID}.execute-api.${REGION}.amazonaws.com/auth"
  echo "    Token URL:         https://${API_ID}.execute-api.${REGION}.amazonaws.com/token"
fi

echo "==> Done"
