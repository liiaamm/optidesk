#!/usr/bin/env bash

# OptiDesk deploy script
# Guided installation and startup script for Linux servers (Debian 12+ / Ubuntu)

set -e

# 1. Directory check and Git cloning
IS_IN_REPO=false
if [ -f "package.json" ]; then
    if grep -q '"name": "optidesk"' package.json; then
        IS_IN_REPO=true
    fi
fi

if [ "$IS_IN_REPO" = false ]; then
    echo "=========================================================="
    echo " Not running inside the OptiDesk repository."
    echo " Creating an 'optidesk' folder and cloning repository..."
    echo "=========================================================="
    
    if ! command -v git &> /dev/null; then
        echo "❌ Error: Git is not installed on this system."
        echo "Please install Git first (e.g. 'sudo apt-get update && sudo apt-get install -y git')."
        exit 1
    fi
    
    if [ ! -d "optidesk" ]; then
        git clone https://github.com/liiaamm/optidesk.git optidesk
    fi
    
    cd optidesk
    # Execute the script from the cloned repository context
    if [ -f "deploy.sh" ]; then
        exec bash deploy.sh "$@"
    else
        echo "❌ Error: Cloned repository does not contain deploy.sh."
        exit 1
    fi
fi

# 2. Dependency verification
echo "========================================="
echo "   Verifying System Dependencies...       "
echo "========================================="

if ! command -v git &> /dev/null; then
    echo "❌ Error: Git is not installed."
    echo "Please install git (e.g. 'sudo apt-get update && sudo apt-get install -y git') and try again."
    exit 1
fi

NODE_OK=true
if ! command -v node &> /dev/null; then
    NODE_OK=false
else
    NODE_VERSION=$(node -v | cut -d'v' -f2)
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1)
    if [ "$NODE_MAJOR" -lt 20 ]; then
        NODE_OK=false
    fi
fi

if [ "$NODE_OK" = false ]; then
    echo "❌ Error: Node.js (version 20 or higher) is required but not found or outdated."
    echo "To install Node.js (v22 LTS) on Debian 12 (Bookworm) or Ubuntu, run:"
    echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
    echo "  sudo apt-get install -y nodejs"
    echo ""
    echo "Alternatively, you can use NVM (Node Version Manager) to install Node.js."
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ Error: npm is not installed."
    echo "Please install npm (usually bundled with Node.js) and try again."
    exit 1
fi

echo "✅ System dependencies verified (Git, Node.js $(node -v), npm $(npm -v))."
echo ""

# 3. NPM package installation
echo "========================================="
echo "   Installing Project Dependencies...    "
echo "========================================="
npm ci
echo "✅ Project dependencies installed."
echo ""

# 4. Run interactive configuration helper
echo "========================================="
echo "   Launching Setup Wizard...             "
echo "========================================="
node scripts/setup-config.js
echo "✅ Configuration files generated successfully."
echo ""

echo "=========================================================="
echo " ACTION REQUIRED before continuing:"
echo "  1. Open data/guild-config.json"
echo "  2. Replace the placeholder channel and role IDs with your Discord IDs"
echo "  3. Save the file"
echo "=========================================================="
read -p "Press Enter once you have reviewed and saved data/guild-config.json..."
echo ""

# 5. Deploy Commands
echo "========================================="
echo "   Deploying Discord Commands...        "
echo "========================================="
set +e
node deploy-commands.js --config
CMD_STATUS=$?
set -e

if [ $CMD_STATUS -ne 0 ]; then
    echo ""
    echo "⚠️ Warning: Failed to sync commands with Discord."
    echo "This is expected if your Discord Bot Token or Client ID is invalid or missing permissions."
    echo "Please verify your Discord credentials in config.json, and manually sync commands later by running:"
    echo "  node deploy-commands.js --config"
    echo ""
else
    echo "✅ Commands deployed to Discord successfully."
    echo ""
fi

# 5.5. Emojis Deployment
# The bot requires its own application emojis to be uploaded to Discord — without
# --upload this only renders local PNGs and the bot ships with no working emojis.
echo "========================================="
echo "   Deploying OptiDesk Emojis...         "
echo "========================================="

# Let the operator pick the emoji fill colour (RGB/RRGGBB, "#" optional —
# same formats scripts/download-emoji-pack.js accepts).
EMOJI_COLOR=""
while [ -z "$EMOJI_COLOR" ]; do
    read -p "Emoji colour hex [default: #9DE8E4]: " color_input
    color_input="${color_input:-#9DE8E4}"
    color_input="${color_input##\#}"
    if [[ "$color_input" =~ ^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$ ]]; then
        EMOJI_COLOR="#${color_input}"
    else
        echo "❌ Invalid hex colour. Use RGB or RRGGBB, e.g. #9DE8E4."
    fi
done

set +e
npm run emojis -- --color "$EMOJI_COLOR" --upload --prefix local_ --set SelfHostEmojis
EMOJI_STATUS=$?
set -e

if [ $EMOJI_STATUS -ne 0 ]; then
    echo ""
    echo "⚠️ Warning: Failed to sync emojis with Discord."
    echo "This is expected if your Discord Bot Token or Client ID is invalid or missing permissions."
    echo "The bot WILL NOT work correctly until this is fixed and re-run: npm run emojis -- --color \"$EMOJI_COLOR\" --upload --prefix local_ --set SelfHostEmojis"
    echo ""
else
    echo "✅ Emojis uploaded to Discord successfully."
    echo ""
    echo "=========================================================="
    echo " ACTION REQUIRED before the bot will render correctly:"
    echo "  1. Open data/guild-config.json"
    echo "  2. Set appearance.emojiSet to \"SelfHostEmojis\""
    echo "  3. Save the file"
    echo "=========================================================="
    read -p "Press Enter once you have reviewed and saved data/guild-config.json..."
fi


# 6. PM2 Startup and boot management
echo "========================================="
echo "   Starting Bot and PM2 Setup...        "
echo "========================================="

# Check if bot is already running under PM2 and delete it to prevent duplicates
npx pm2 delete optidesk &> /dev/null || true

# The setup wizard generates ecosystem.config.js (gitignored — may hold AWS
# credentials); fall back to the committed template if it's missing.
if [ ! -f "ecosystem.config.js" ]; then
    cp ecosystem.config.example.js ecosystem.config.js
fi

# Start with ecosystem config
npx pm2 start ecosystem.config.js

echo "✅ Bot started successfully under PM2."
echo ""

# Ask if they want PM2 startup script
read -p "Would you like to configure PM2 to start on system boot? (y/n) [n]: " configure_startup
if [[ "$configure_startup" =~ ^[Yy](es)?$ ]]; then
    echo "Generating PM2 startup script command..."
    # npx pm2 startup runs and prints the command to execute
    STARTUP_CMD=$(npx pm2 startup | grep "sudo env" || true)
    
    if [ -n "$STARTUP_CMD" ]; then
        echo ""
        echo "=========================================================="
        echo " IMPORTANT: Copy and run the following command to enable"
        echo " PM2 system startup service on boot:"
        echo ""
        echo " $STARTUP_CMD"
        echo "=========================================================="
        echo ""
        read -p "Press Enter once you have run the command above to save the current PM2 process list..."
        npx pm2 save
        echo "✅ PM2 process list saved."
    else
        echo "⚠️ Could not auto-detect the PM2 startup command."
        echo "You can configure it manually by running: npx pm2 startup"
    fi
fi

echo ""
echo "=========================================================="
echo " OptiDesk Deployment Complete! "
echo ""
echo " View real-time logs with:  npx pm2 logs"
echo " View bot status with:      npx pm2 status"
echo " Restart the bot with:      npx pm2 restart optidesk"
echo "=========================================================="
