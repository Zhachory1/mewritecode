#!/usr/bin/env bash
set -euo pipefail

# Build static APT and Yum repositories from release .deb/.rpm artifacts.
#
# Usage:
#   ./scripts/build-linux-repos.sh <artifacts-dir> <output-dir>
#
# Outputs:
#   <output-dir>/apt/Packages{,.gz} + .deb files
#   <output-dir>/yum/repodata/ + .rpm files

if [ $# -ne 2 ]; then
    echo "Usage: $0 <artifacts-dir> <output-dir>" >&2
    exit 1
fi

ARTIFACTS_DIR="$1"
OUTPUT_DIR="$2"

if [ ! -d "$ARTIFACTS_DIR" ]; then
    echo "Error: artifacts directory not found: $ARTIFACTS_DIR" >&2
    exit 1
fi

require_tool() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "Error: $1 not found. $2" >&2
        exit 1
    }
}

require_tool dpkg-scanpackages "Install with: sudo apt-get install -y dpkg-dev"
require_tool createrepo_c "Install with: sudo apt-get install -y createrepo-c"
require_tool gzip "Install gzip and try again"

shopt -s nullglob
DEBS=("$ARTIFACTS_DIR"/mewrite-code_*.deb)
RPMS=("$ARTIFACTS_DIR"/mewrite-code-*.rpm)

if [ ${#DEBS[@]} -eq 0 ]; then
    echo "Error: no Debian packages found in $ARTIFACTS_DIR" >&2
    exit 1
fi

if [ ${#RPMS[@]} -eq 0 ]; then
    echo "Error: no RPM packages found in $ARTIFACTS_DIR" >&2
    exit 1
fi

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/apt" "$OUTPUT_DIR/yum"

cp "${DEBS[@]}" "$OUTPUT_DIR/apt/"
cp "${RPMS[@]}" "$OUTPUT_DIR/yum/"

(
    cd "$OUTPUT_DIR/apt"
    dpkg-scanpackages . /dev/null > Packages
    gzip -9c Packages > Packages.gz
)

createrepo_c --quiet "$OUTPUT_DIR/yum"

cat > "$OUTPUT_DIR/apt/README.txt" <<'EOF'
Add this APT repository with:

echo "deb [trusted=yes] https://raw.githubusercontent.com/Zhachory1/mewritecode/gh-pages/apt ./" | sudo tee /etc/apt/sources.list.d/mewrite.list
sudo apt update
sudo apt install mewrite-code
EOF

cat > "$OUTPUT_DIR/yum/mewrite.repo" <<'EOF'
[mewrite]
name=Me Write Code
baseurl=https://raw.githubusercontent.com/Zhachory1/mewritecode/gh-pages/yum
enabled=1
gpgcheck=0
EOF

cat > "$OUTPUT_DIR/yum/README.txt" <<'EOF'
Add this Yum/DNF repository with:

sudo curl -fsSL https://raw.githubusercontent.com/Zhachory1/mewritecode/gh-pages/yum/mewrite.repo -o /etc/yum.repos.d/mewrite.repo
sudo dnf install mewrite-code

Use `sudo yum install mewrite-code` on yum-based systems.
EOF

echo "Built APT repo: $OUTPUT_DIR/apt"
echo "Built Yum repo: $OUTPUT_DIR/yum"
