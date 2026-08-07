import { NextResponse } from "next/server";

/**
 * Setup Script Endpoint
 *
 * Serves the Plexus agent setup script for device onboarding.
 *
 * Usage:
 *   curl -sL https://app.plexus.company/setup | bash -s -- --key plx_abc123
 */

const SETUP_SCRIPT = `#!/bin/bash
#
# Plexus Agent Setup Script
#
# Usage:
#   curl -sL https://app.plexus.company/setup | bash -s -- --key plx_abc123
#

set -e

# ─────────────────────────────────────────────────────────────────────────────
# Styling
# ─────────────────────────────────────────────────────────────────────────────

# Colors
RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[0;33m'
CYAN='\\033[0;36m'
DIM='\\033[2m'
BOLD='\\033[1m'
NC='\\033[0m'

# Symbols
CHECK="✓"
CROSS="✗"
BULLET="•"
SPINNER_FRAMES=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")

# Layout
WIDTH=45

header() {
    echo ""
    echo -e "  \${DIM}┌$(printf '─%.0s' \$(seq 1 $((WIDTH-2))))┐\${NC}"
    echo -e "  \${DIM}│  $1$(printf ' %.0s' \$(seq 1 $((WIDTH-\${#1}-5))))│\${NC}"
    echo -e "  \${DIM}└$(printf '─%.0s' \$(seq 1 $((WIDTH-2))))┘\${NC}"
    echo ""
}

divider() {
    echo -e "  \${DIM}$(printf '─%.0s' \$(seq 1 $((WIDTH-2))))\${NC}"
}

success() {
    echo -e "  \${GREEN}$CHECK $1\${NC}"
}

error() {
    echo -e "  \${RED}$CROSS $1\${NC}"
}

warn() {
    echo -e "  \${YELLOW}$BULLET $1\${NC}"
}

info() {
    echo "  $1"
}

dim() {
    echo -e "  \${DIM}$1\${NC}"
}

hint() {
    echo -e "  \${CYAN}$1\${NC}"
}

label() {
    printf "  %-12s %s\\n" "$1" "$2"
}

# Spinner function
spin() {
    local msg="$1"
    local pid=$2
    local i=0
    while kill -0 $pid 2>/dev/null; do
        printf "\\r  \${SPINNER_FRAMES[$((i % 10))]} %s" "$msg"
        i=$((i + 1))
        sleep 0.08
    done
    printf "\\r%*s\\r" $((WIDTH + 10)) ""
}

# Run command with spinner
run_with_spinner() {
    local msg="$1"
    shift
    "$@" &>/dev/null &
    local pid=$!
    spin "$msg" $pid
    wait $pid
    return $?
}

# ─────────────────────────────────────────────────────────────────────────────
# Parse Arguments
# ─────────────────────────────────────────────────────────────────────────────

API_KEY=""
DEVICE_NAME=""
DEVICE_SLUG=""
ORG_ID=""
ENDPOINT="https://app.plexus.company"
SKIP_SERVICE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --api-key|--key|-k)
            API_KEY="$2"
            shift 2
            ;;
        --name|-n)
            DEVICE_NAME="$2"
            shift 2
            ;;
        --device-id|-s|--slug)
            DEVICE_SLUG="$2"
            shift 2
            ;;
        --org)
            ORG_ID="$2"
            shift 2
            ;;
        --endpoint)
            ENDPOINT="$2"
            shift 2
            ;;
        --no-service)
            SKIP_SERVICE=true
            shift
            ;;
        *)
            shift
            ;;
    esac
done

# ─────────────────────────────────────────────────────────────────────────────
# Setup
# ─────────────────────────────────────────────────────────────────────────────

header "Plexus Setup"

# Detect system
OS=$(uname -s)
ARCH=$(uname -m)
label "System" "$OS $ARCH"

# Check for Python — auto-install if missing
if command -v python3 &> /dev/null; then
    PYTHON=python3
elif command -v python &> /dev/null; then
    PYTHON=python
else
    warn "Python not found — installing..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update -qq && sudo apt-get install -y -qq python3 python3-pip
    elif command -v dnf &> /dev/null; then
        sudo dnf install -y -q python3 python3-pip
    elif command -v yum &> /dev/null; then
        sudo yum install -y -q python3 python3-pip
    elif command -v brew &> /dev/null; then
        brew install python3
    else
        error "Could not install Python automatically"
        hint "  Install Python 3.8+ manually, then re-run this script"
        echo ""
        exit 1
    fi

    # Re-detect after install
    if command -v python3 &> /dev/null; then
        PYTHON=python3
    elif command -v python &> /dev/null; then
        PYTHON=python
    else
        error "Python installation failed"
        echo ""
        exit 1
    fi
    success "Python installed"
fi

PYTHON_VERSION=$($PYTHON --version 2>&1 | cut -d' ' -f2)
label "Python" "$PYTHON_VERSION"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Install Agent
# ─────────────────────────────────────────────────────────────────────────────

divider
echo ""

# Check if python3-venv is available (needed on Debian/Ubuntu)
if [ "$OS" = "Linux" ] && ! $PYTHON -c "import venv" 2>/dev/null; then
    if command -v apt-get &> /dev/null; then
        if [ "\$EUID" -eq 0 ]; then
            run_with_spinner "Installing python3-venv..." apt-get update -qq
            run_with_spinner "Installing python3-venv..." apt-get install -y -qq python3-venv
        elif sudo -n true 2>/dev/null; then
            run_with_spinner "Installing python3-venv..." sudo apt-get update -qq
            run_with_spinner "Installing python3-venv..." sudo apt-get install -y -qq python3-venv
        else
            error "python3-venv is required but not installed"
            hint "  Run: sudo apt install python3-venv"
            echo ""
            exit 1
        fi
    fi
fi

# Use a virtual environment to avoid PEP 668 issues on modern Python/Debian
VENV_DIR="/opt/plexus/venv"
PLEXUS_BIN_DIR="/opt/plexus/bin"

if [ "$OS" = "Linux" ]; then
    if [ "\$EUID" -eq 0 ]; then
        mkdir -p /opt/plexus
    elif sudo -n true 2>/dev/null; then
        sudo mkdir -p /opt/plexus
        sudo chown \$USER:\$USER /opt/plexus
    else
        # Fall back to user directory if no sudo
        VENV_DIR="\$HOME/.plexus/venv"
        PLEXUS_BIN_DIR="\$HOME/.plexus/bin"
        mkdir -p "\$HOME/.plexus"
    fi
else
    VENV_DIR="\$HOME/.plexus/venv"
    PLEXUS_BIN_DIR="\$HOME/.plexus/bin"
    mkdir -p "\$HOME/.plexus"
fi

# Create virtual environment if it doesn't exist
if [ ! -d "\$VENV_DIR" ]; then
    if ! run_with_spinner "Creating virtual environment..." $PYTHON -m venv "\$VENV_DIR"; then
        error "Failed to create virtual environment"
        exit 1
    fi
fi

VENV_PIP="\$VENV_DIR/bin/pip"

# Install agent into venv
run_with_spinner "Upgrading pip..." "\$VENV_PIP" install --upgrade pip --quiet

IS_PI=false
if [ -f /proc/device-tree/model ] && grep -qi "raspberry" /proc/device-tree/model 2>/dev/null; then
    IS_PI=true
fi

# Install system packages for camera support on Pi
if [ "$IS_PI" = true ] && command -v apt-get &> /dev/null; then
    PKGS=""
    dpkg -s libcap-dev &> /dev/null 2>&1 || PKGS="libcap-dev"
    if [ -n "$PKGS" ]; then
        if [ "\$EUID" -eq 0 ]; then
            run_with_spinner "Installing system packages..." apt-get install -y -qq $PKGS
        elif sudo -n true 2>/dev/null; then
            run_with_spinner "Installing system packages..." sudo apt-get install -y -qq $PKGS
        fi
    fi
fi

# Add user to i2c group for sensor access without sudo
if [ "$OS" = "Linux" ] && getent group i2c &> /dev/null && ! id -nG | grep -qw i2c; then
    if [ "\$EUID" -eq 0 ]; then
        usermod -aG i2c "\$USER"
    elif sudo -n true 2>/dev/null; then
        sudo usermod -aG i2c "\$USER"
    fi
fi

if [ "$OS" = "Linux" ]; then
    EXTRAS="sensors"
    if [ "$IS_PI" = true ]; then
        EXTRAS="sensors,picamera"
    fi
    if run_with_spinner "Installing plexus-python..." "\$VENV_PIP" install --upgrade "plexus-python[$EXTRAS]" --quiet 2>/dev/null || \\
       run_with_spinner "Installing plexus-python..." "\$VENV_PIP" install --upgrade "plexus-python[sensors]" --quiet 2>/dev/null || \\
       run_with_spinner "Installing plexus-python..." "\$VENV_PIP" install --upgrade plexus-python --quiet; then
        success "Agent installed"
    else
        error "Installation failed"
        exit 1
    fi
else
    if run_with_spinner "Installing plexus-python..." "\$VENV_PIP" install --upgrade plexus-python --quiet; then
        success "Agent installed"
    else
        error "Installation failed"
        exit 1
    fi
fi

# Make 'plexus' command available system-wide
VENV_PLEXUS="\$VENV_DIR/bin/plexus"
if [ -f "\$VENV_PLEXUS" ]; then
    mkdir -p "\$PLEXUS_BIN_DIR"
    ln -sf "\$VENV_PLEXUS" "\$PLEXUS_BIN_DIR/plexus"

    if [ "$OS" = "Linux" ]; then
        # Add to PATH via bashrc
        PROFILE_FILE="\$HOME/.bashrc"
        if ! grep -q "\$PLEXUS_BIN_DIR" "\$PROFILE_FILE" 2>/dev/null; then
            echo "" >> "\$PROFILE_FILE"
            echo "# Plexus agent" >> "\$PROFILE_FILE"
            echo "export PATH=\\"\$PLEXUS_BIN_DIR:\\\$PATH\\"" >> "\$PROFILE_FILE"
        fi
        export PATH="\$PLEXUS_BIN_DIR:\$PATH"

        # Also symlink to /usr/local/bin if possible
        if [ "\$EUID" -eq 0 ]; then
            ln -sf "\$VENV_PLEXUS" /usr/local/bin/plexus
        elif sudo -n true 2>/dev/null; then
            sudo ln -sf "\$VENV_PLEXUS" /usr/local/bin/plexus
        fi
    fi
fi

echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Configure Device
# ─────────────────────────────────────────────────────────────────────────────

divider
echo ""

if [ -n "$API_KEY" ]; then
    # API key flow — write config and skip pairing
    mkdir -p "$HOME/.plexus"

    # Build config JSON
    CONFIG="{\\"api_key\\":\\"$API_KEY\\",\\"endpoint\\":\\"$ENDPOINT\\""
    if [ -n "$DEVICE_SLUG" ]; then
        CONFIG="$CONFIG,\\"source_id\\":\\"$DEVICE_SLUG\\""
    fi
    if [ -n "$DEVICE_NAME" ]; then
        CONFIG="$CONFIG,\\"source_name\\":\\"$DEVICE_NAME\\""
        # Derive slug from name if no explicit slug
        if [ -z "$DEVICE_SLUG" ]; then
            SOURCE_ID=$(echo "$DEVICE_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')
            CONFIG="$CONFIG,\\"source_id\\":\\"$SOURCE_ID\\""
        fi
    fi
    if [ -n "$ORG_ID" ]; then
        CONFIG="$CONFIG,\\"org_id\\":\\"$ORG_ID\\""
    fi
    CONFIG="$CONFIG}"

    echo "$CONFIG" > "$HOME/.plexus/config.json"
    export PLEXUS_API_KEY="$API_KEY"
    success "API key configured"
    if [ -n "$DEVICE_SLUG" ]; then
        success "Device ID: $DEVICE_SLUG"
    fi
    if [ -n "$DEVICE_NAME" ]; then
        success "Device name: $DEVICE_NAME"
    fi
    if [ -n "$ORG_ID" ]; then
        success "Organization: $ORG_ID"
    fi
    echo ""
else
    warn "No API key provided"
    echo ""
    dim "To connect this device, run:"
    echo ""
    hint "  plexus start"
    echo ""
    dim "You'll be prompted to sign up or sign in."
    echo ""
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Setup Service (Linux only)
# ─────────────────────────────────────────────────────────────────────────────

if [ "$OS" = "Linux" ] && [ "$SKIP_SERVICE" = false ]; then
    divider
    echo ""

    PLEXUS_USER=\${SUDO_USER:-$USER}
    PLEXUS_HOME=$(eval echo ~$PLEXUS_USER)
    PLEXUS_BIN=$(which plexus 2>/dev/null || echo "/usr/local/bin/plexus")
    SERVICE_FILE="/etc/systemd/system/plexus.service"

    # Build optional flags
    API_KEY_ENV=""
    if [ -n "$API_KEY" ]; then
        API_KEY_ENV="Environment=PLEXUS_API_KEY=$API_KEY"
    fi

    EXEC_CMD="$PLEXUS_BIN run"
    if [ -n "$DEVICE_NAME" ]; then
        EXEC_CMD="$PLEXUS_BIN run --name \\"$DEVICE_NAME\\""
    fi

    if [ "$EUID" -eq 0 ] || sudo -n true 2>/dev/null; then
        sudo tee $SERVICE_FILE > /dev/null << EOF
[Unit]
Description=Plexus Agent
Documentation=https://docs.plexus.company
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$PLEXUS_USER
ExecStart=$EXEC_CMD
Restart=always
RestartSec=10
Environment=PLEXUS_CONFIG_DIR=$PLEXUS_HOME/.plexus
$API_KEY_ENV

StandardOutput=journal
StandardError=journal
SyslogIdentifier=plexus

NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$PLEXUS_HOME/.plexus

[Install]
WantedBy=multi-user.target
EOF

        sudo systemctl daemon-reload
        sudo systemctl enable plexus.service &>/dev/null

        # Auto-start when API key is provided
        if [ -n "$API_KEY" ]; then
            sudo systemctl start plexus.service &>/dev/null
            success "Service installed and started"
        else
            success "Service installed"
        fi
        echo ""
        dim "Service commands:"
        info "  systemctl start plexus     Start now"
        info "  systemctl status plexus    Check status"
        info "  journalctl -u plexus -f    View logs"
        echo ""
    else
        warn "Skipped service setup (no sudo)"
        echo ""
        dim "To set up auto-start, run with sudo:"
        hint "curl -sL https://app.plexus.company/setup | sudo bash"
        echo ""
    fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────────────────────────────────

divider
echo ""
success "Setup complete"
echo ""
dim "Commands:"
info "  plexus start     Set up and stream"
info "  plexus reset     Clear config and start over"
echo ""
hint "Dashboard: https://app.plexus.company"
echo ""
divider
echo ""
dim "What was installed:"
info "  Virtual env:  \$VENV_DIR"
info "  Config:       \$HOME/.plexus/config.json"
if [ "$OS" = "Linux" ] && [ -f "/etc/systemd/system/plexus.service" ]; then
    info "  Service:      /etc/systemd/system/plexus.service"
fi
info "  Binary:       \$PLEXUS_BIN_DIR/plexus"
echo ""
dim "To uninstall:"
info "  rm -rf \$VENV_DIR \$PLEXUS_BIN_DIR \$HOME/.plexus"
if [ "$OS" = "Linux" ]; then
    info "  sudo systemctl stop plexus && sudo systemctl disable plexus"
    info "  sudo rm /etc/systemd/system/plexus.service"
fi
echo ""
`;

export async function GET() {
  return new NextResponse(SETUP_SCRIPT, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": "inline; filename=setup.sh",
      // Allow caching for 5 minutes
      "Cache-Control": "public, max-age=300",
    },
  });
}
