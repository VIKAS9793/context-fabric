#!/bin/bash
# scripts/install-hook.sh
# Installs a post-commit hook to trigger cf_capture

HOOK_DIR=".git/hooks"
HOOK_FILE="$HOOK_DIR/post-commit"

if [ ! -d ".git" ]; then
  echo "Error: Not a git repository."
  exit 1
fi

cat << 'EOF' > "$HOOK_FILE"
#!/bin/bash
# Trigger Context Fabric capture
npm run build && node dist/cli.js capture
EOF

chmod +x "$HOOK_FILE"
echo "Context Fabric post-commit hook installed."
