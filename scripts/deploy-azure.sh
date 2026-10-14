#!/usr/bin/env bash
# Build and deploy to Azure App Service (Linux, Node) with `az webapp up`.
# Re-run to redeploy. Tear down with: az group delete -n "$RG"
#
#   APP       web app name (globally unique; becomes https://$APP.azurewebsites.net)
#   RG        resource group      (default icd11-tx-ui-rg)
#   LOCATION  Azure region        (default australiaeast)
#   SKU       App Service plan    (default B1)
#   RUNTIME   Node runtime        (default NODE:22-lts; see az webapp list-runtimes --os-type linux)
set -euo pipefail

APP=${APP:?set APP to a globally unique web app name}
RG=${RG:-icd11-tx-ui-rg}
LOCATION=${LOCATION:-australiaeast}
SKU=${SKU:-B1}
RUNTIME=${RUNTIME:-NODE:22-lts}

cd "$(dirname "$0")/.."
pnpm install --frozen-lockfile
pnpm build

# Stage only what the server needs: no node_modules, no build on the server.
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -R dist server.mjs proxy.mjs "$STAGE"/
cat > "$STAGE/package.json" <<JSON
{ "name": "icd11-tx-test-ui", "private": true, "type": "module",
  "scripts": { "start": "node server.mjs" } }
JSON

cd "$STAGE"
az webapp up \
  --name "$APP" \
  --resource-group "$RG" \
  --location "$LOCATION" \
  --sku "$SKU" \
  --runtime "$RUNTIME" \
  --os-type Linux

az webapp config set -g "$RG" -n "$APP" --startup-file "node server.mjs" --always-on true --output none
az webapp config appsettings set -g "$RG" -n "$APP" --settings SCM_DO_BUILD_DURING_DEPLOYMENT=false --output none

echo "Deployed: https://$APP.azurewebsites.net"
