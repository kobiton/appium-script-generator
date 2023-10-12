#!/bin/bash

# This script is for running the Appium Script Generator on Kobiton environment

echo "Use following env vars: \
  - KOBITON_APPIUM_SCRIPT_GENERATOR_GRPC_SERVER_HOST
  - KOBITON_APPIUM_SCRIPT_GENERATOR_GRPC_SERVER_PORT
  - KOBITON_APPIUM_SCRIPT_GENERATOR_GRPC_SERVER_NODE_ID
"

consul_client_container_name=consul-client-node
filename=appium-script-generator-grpc-server-definition.json
temp_service_file=/tmp/$filename

grpc_server_host=${KOBITON_APPIUM_SCRIPT_GENERATOR_GRPC_SERVER_HOST:-localhost}
grpc_server_port=${KOBITON_APPIUM_SCRIPT_GENERATOR_GRPC_SERVER_PORT:-7009}
grpc_server_node_id=${KOBITON_APPIUM_SCRIPT_GENERATOR_GRPC_SERVER_NODE_ID:-appium-script-generator-grpc-server-1}

# This json file is for local development therefore configurations are for that purpose
# For instance, "check.interval" is short because we keep restarting the service and
# we want Consul to update the state asap
cat <<EOT > $temp_service_file
{
  "service": {
    "id": "$grpc_server_node_id",
    "name": "appium-script-generator-grpc-server",
    "Address": "$grpc_server_host",
    "Port": $grpc_server_port,
    "tags": ["aws-us-east-1"],
    "meta": {
      "grpc_service_private_address": "$grpc_server_host:$grpc_server_port"
    }
  }
}
EOT

docker cp $temp_service_file $consul_client_container_name:/consul/config/$filename
docker exec $consul_client_container_name consul services register /consul/config/$filename
