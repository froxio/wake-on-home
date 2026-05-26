#!/usr/bin/env bash
# Deploys or updates the wake-on-home Lambda function.
# Usage: ./deploy.sh <aws-account-id> <bridge-url> <bridge-secret>
#
# First run:  creates the function + API Gateway trigger
# Later runs: updates the function code and env vars

set -euo pipefail

ACCOUNT_ID="${1:?Usage: ./deploy.sh <aws-account-id> <bridge-url> <bridge-secret>}"
BRIDGE_URL="${2:?bridge-url required}"
BRIDGE_SECRET="${3:?bridge-secret required}"

FUNCTION_NAME="wake-on-home"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/lambda-basic-execution"

echo "==> Zipping function"
zip -r function.zip index.js package.json

if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" &>/dev/null; then
  echo "==> Updating existing function"
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file fileb://function.zip \
    --region "$REGION"

  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --environment "Variables={BRIDGE_URL=${BRIDGE_URL},BRIDGE_SECRET=${BRIDGE_SECRET}}" \
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
    --environment "Variables={BRIDGE_URL=${BRIDGE_URL},BRIDGE_SECRET=${BRIDGE_SECRET}}" \
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
  echo "==> API Gateway endpoint:"
  echo "    https://${API_ID}.execute-api.${REGION}.amazonaws.com"
  echo "    Set this as your fulfillment URL in the Actions on Google console."
fi

echo "==> Done"
