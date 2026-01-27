#!/bin/bash
# Spot Runner Bootstrap Script
# This script runs on EC2 instance startup to register and run a GitHub Actions runner.
set -euo pipefail

# Configuration
RUNNER_DIR="/opt/actions-runner"
LOG_FILE="/var/log/runner-bootstrap.log"
METADATA_URL="http://169.254.169.254/latest"
IMDS_TOKEN_TTL=21600  # 6 hours

# Log everything to file and stdout
exec > >(tee -a "$LOG_FILE") 2>&1
echo "=========================================="
echo "Spot Runner Bootstrap - $(date -Iseconds)"
echo "=========================================="

# Get IMDSv2 token
get_imds_token() {
    curl -s -X PUT "$METADATA_URL/api/token" \
        -H "X-aws-ec2-metadata-token-ttl-seconds: $IMDS_TOKEN_TTL"
}

# Get metadata with IMDSv2
get_metadata() {
    local path="$1"
    local token
    token=$(get_imds_token)
    curl -s -H "X-aws-ec2-metadata-token: $token" "$METADATA_URL/$path"
}

# Get instance metadata
INSTANCE_ID=$(get_metadata "meta-data/instance-id")
REGION=$(get_metadata "meta-data/placement/region")
AZ=$(get_metadata "meta-data/placement/availability-zone")

echo "Instance: $INSTANCE_ID"
echo "Region: $REGION"
echo "Availability Zone: $AZ"

# Get user data (contains JIT config)
USER_DATA=$(get_metadata "user-data" | base64 -d 2>/dev/null || get_metadata "user-data")

# Extract JIT config from user data (expects base64 encoded JSON)
JIT_CONFIG=$(echo "$USER_DATA" | grep -oP '(?<=JIT_CONFIG=)[^\s]+' | base64 -d 2>/dev/null || echo "")

if [ -z "$JIT_CONFIG" ]; then
    echo "ERROR: JIT_CONFIG not found in user data"
    # Self-terminate on failure
    aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" --region "$REGION"
    exit 1
fi

# Ensure runner directory exists
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

# Download runner if not present (for non-baked AMIs)
if [ ! -f "./run.sh" ]; then
    echo "Downloading GitHub Actions runner..."
    RUNNER_VERSION="2.331.0"

    # Hardcoded SHA256 checksums for supply chain security
    # These must be updated when RUNNER_VERSION changes
    RUNNER_SHA256_X64="5fcc01bd546ba5c3f1291c2803658ebd3cedb3836489eda3be357d41bfcf28a7"
    RUNNER_SHA256_ARM64="f5863a211241436186723159a111f352f25d5d22711639761ea24c98caef1a9a"

    # Detect architecture and set checksum
    RUNNER_ARCH="x64"
    EXPECTED_SHA="$RUNNER_SHA256_X64"
    if [ "$(uname -m)" = "aarch64" ]; then
        RUNNER_ARCH="arm64"
        EXPECTED_SHA="$RUNNER_SHA256_ARM64"
    fi

    RUNNER_TAR="actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"
    RUNNER_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_TAR}"

    # Download runner tarball
    curl -o actions-runner.tar.gz -L "$RUNNER_URL"

    # Verify SHA256 checksum against hardcoded value
    echo "Verifying SHA256 checksum..."
    ACTUAL_SHA=$(sha256sum actions-runner.tar.gz | awk '{print $1}')

    if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
        echo "ERROR: SHA256 verification failed!"
        echo "Expected: $EXPECTED_SHA"
        echo "Actual:   $ACTUAL_SHA"
        rm -f actions-runner.tar.gz
        aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" --region "$REGION"
        exit 1
    fi
    echo "SHA256 verification passed"

    tar xzf ./actions-runner.tar.gz
    rm ./actions-runner.tar.gz
fi

# Write JIT config to file
echo "$JIT_CONFIG" > .jitconfig

# Start spot interruption handler in background
start_interruption_handler() {
    echo "Starting spot interruption handler..."
    while true; do
        local token
        token=$(get_imds_token)

        # Check for spot interruption notice
        INTERRUPTION=$(curl -s -H "X-aws-ec2-metadata-token: $token" \
            "$METADATA_URL/meta-data/spot/instance-action" 2>/dev/null || echo "")

        if [ -n "$INTERRUPTION" ] && [ "$INTERRUPTION" != "404" ]; then
            echo "SPOT INTERRUPTION DETECTED: $INTERRUPTION"
            echo "Attempting graceful shutdown..."

            # Signal the runner to stop accepting new jobs
            if [ -f "$RUNNER_DIR/.runner" ]; then
                # Send SIGTERM to runner process
                pkill -TERM -f "Runner.Listener" || true
            fi

            # Give runner 90 seconds to finish current step
            sleep 90

            # Force terminate if still running
            pkill -KILL -f "Runner.Listener" || true

            echo "Interruption handling complete"
            exit 0
        fi

        # Check every 5 seconds
        sleep 5
    done
}

# Start interruption handler in background
start_interruption_handler &
HANDLER_PID=$!

# Run the runner with JIT config
echo "Starting GitHub Actions runner..."
./run.sh --jitconfig .jitconfig &
RUNNER_PID=$!

# Wait for runner to exit
wait $RUNNER_PID
RUNNER_EXIT=$?

echo "Runner exited with code: $RUNNER_EXIT"

# Kill the interruption handler
kill $HANDLER_PID 2>/dev/null || true

# Clean up JIT config
rm -f .jitconfig

# Self-terminate the instance
echo "Self-terminating instance $INSTANCE_ID..."
aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" --region "$REGION"

echo "Bootstrap complete"
exit $RUNNER_EXIT
