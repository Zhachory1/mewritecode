#!/usr/bin/env bash
set -euo pipefail

# Build Debian and RPM packages from Linux tarball archives.
#
# Usage:
#   ./scripts/build-linux-packages.sh <version-or-tag> [archives-dir]
#
# Expects:
#   - mewrite-linux-x64.tar.gz and/or mewrite-linux-arm64.tar.gz in archives-dir
#   - dpkg-deb for building .deb packages
#   - rpmbuild for building .rpm packages
#
# Outputs:
#   - mewrite-code_<version>_amd64.deb
#   - mewrite-code_<version>_arm64.deb
#   - mewrite-code-<version>-1.x86_64.rpm
#   - mewrite-code-<version>-1.aarch64.rpm

cd "$(dirname "$0")/.."

if [ $# -lt 1 ]; then
    echo "Usage: $0 <version-or-tag> [archives-dir]" >&2
    exit 1
fi

VERSION_RAW="$1"
ARCHIVES_DIR="${2:-packages/coding-agent/binaries}"

VERSION="${VERSION_RAW#v}"
RPM_VERSION="$(echo "$VERSION" | sed 's/[^A-Za-z0-9._+]/_/g')"

if [ ! -d "$ARCHIVES_DIR" ]; then
    echo "Error: Archives directory not found: $ARCHIVES_DIR" >&2
    exit 1
fi

if [ ! -f "$ARCHIVES_DIR/mewrite-linux-x64.tar.gz" ] && [ ! -f "$ARCHIVES_DIR/mewrite-linux-arm64.tar.gz" ]; then
    echo "Error: No Linux archives found in $ARCHIVES_DIR" >&2
    echo "Expected: mewrite-linux-x64.tar.gz and/or mewrite-linux-arm64.tar.gz" >&2
    exit 1
fi

PKG_NAME="mewrite-code"
MAINTAINER="Zhachory Volker"
HOMEPAGE="https://github.com/Zhachory1/mewritecode"
DESCRIPTION="Me Write Code terminal coding agent"
SECTION="devel"
PRIORITY="optional"
LIB_DIR="/usr/lib/mewrite-code"
BIN_TARGET="../lib/mewrite-code/mewrite"
COMMANDS=(mewrite mewrite-code mewritecode)

require_tool() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "Error: $1 not found. $2" >&2
        exit 1
    }
}

build_deb() {
    local arch_name="$1"
    local deb_arch="$2"
    local tarball="$ARCHIVES_DIR/mewrite-linux-${arch_name}.tar.gz"

    if [ ! -f "$tarball" ]; then
        echo "Skipping .deb for $arch_name (tarball not found)"
        return
    fi

    require_tool dpkg-deb "Install with: sudo apt-get install -y dpkg-dev"

    local build_dir="$ARCHIVES_DIR/deb-build-${deb_arch}"
    local deb_file="$ARCHIVES_DIR/${PKG_NAME}_${VERSION}_${deb_arch}.deb"

    echo "Building .deb for ${arch_name} (${deb_arch})..."

    rm -rf "$build_dir"
    mkdir -p "$build_dir/DEBIAN" "$build_dir${LIB_DIR}" "$build_dir/usr/bin"

    tar -xzf "$tarball" --strip-components=1 -C "$build_dir${LIB_DIR}"

    for cmd in "${COMMANDS[@]}"; do
        ln -s "$BIN_TARGET" "$build_dir/usr/bin/$cmd"
    done

    cat > "$build_dir/DEBIAN/control" <<EOF
Package: $PKG_NAME
Version: $VERSION
Section: $SECTION
Priority: $PRIORITY
Architecture: $deb_arch
Maintainer: $MAINTAINER
Homepage: $HOMEPAGE
Description: $DESCRIPTION
 Me Write Code is a terminal coding agent.
EOF

    dpkg-deb --build --root-owner-group "$build_dir" "$deb_file" >/dev/null || {
        echo "Error: dpkg-deb failed for $deb_file" >&2
        exit 1
    }

    echo "Validating $deb_file..."
    dpkg-deb --info "$deb_file"
    echo "Created: $deb_file"

    rm -rf "$build_dir"
}

build_rpm() {
    local arch_name="$1"
    local rpm_arch="$2"
    local tarball="$ARCHIVES_DIR/mewrite-linux-${arch_name}.tar.gz"

    if [ ! -f "$tarball" ]; then
        echo "Skipping .rpm for $arch_name (tarball not found)"
        return
    fi

    require_tool rpmbuild "Install with: sudo apt-get install -y rpm or sudo yum install rpm-build"

    local build_root="$ARCHIVES_DIR/rpm-build-${rpm_arch}"
    local rpm_root="$build_root/rpmbuild"

    echo "Building .rpm for ${arch_name} (${rpm_arch})..."

    rm -rf "$build_root"
    mkdir -p "$rpm_root"/{BUILD,RPMS,SOURCES,SPECS,SRPMS}

    cp "$tarball" "$rpm_root/SOURCES/${PKG_NAME}-${RPM_VERSION}.tar.gz"

    cat > "$rpm_root/SPECS/${PKG_NAME}.spec" <<EOF
Name:           $PKG_NAME
Version:        $RPM_VERSION
Release:        1%{?dist}
Summary:        $DESCRIPTION
License:        MIT
URL:            $HOMEPAGE
Source0:        $PKG_NAME-%{version}.tar.gz

%description
Me Write Code is a terminal coding agent.

%prep
%setup -q -c

%install
rm -rf %{buildroot}
mkdir -p %{buildroot}${LIB_DIR}
mkdir -p %{buildroot}/usr/bin
cp -r mewrite/* %{buildroot}${LIB_DIR}/
for cmd in ${COMMANDS[*]}; do
  ln -s $BIN_TARGET %{buildroot}/usr/bin/\$cmd
done

%files
%dir ${LIB_DIR}
${LIB_DIR}/*
/usr/bin/mewrite
/usr/bin/mewrite-code
/usr/bin/mewritecode

%changelog
* $(date "+%a %b %d %Y") $MAINTAINER - $RPM_VERSION-1
- Release $RPM_VERSION
EOF

    local rpm_log="$build_root/rpmbuild.log"
    rpmbuild --define "_topdir $rpm_root" \
        --target "$rpm_arch" \
        -bb "$rpm_root/SPECS/${PKG_NAME}.spec" >"$rpm_log" 2>&1 || {
        echo "Error: rpmbuild failed for ${arch_name} (${rpm_arch})" >&2
        cat "$rpm_log" >&2
        exit 1
    }

    local rpm_file
    rpm_file=$(find "$rpm_root/RPMS/$rpm_arch" -name "*.rpm" | head -n1)

    if [ -z "$rpm_file" ]; then
        echo "Error: RPM build did not produce expected output" >&2
        exit 1
    fi

    cp "$rpm_file" "$ARCHIVES_DIR/"
    local final_rpm="$ARCHIVES_DIR/$(basename "$rpm_file")"

    if command -v rpm >/dev/null 2>&1; then
        echo "Validating $final_rpm..."
        rpm -qip "$final_rpm"
    fi

    echo "Created: $final_rpm"

    rm -rf "$build_root"
}

if [ -f "$ARCHIVES_DIR/mewrite-linux-x64.tar.gz" ]; then
    build_deb x64 amd64
    build_rpm x64 x86_64
fi

if [ -f "$ARCHIVES_DIR/mewrite-linux-arm64.tar.gz" ]; then
    build_deb arm64 arm64
    build_rpm arm64 aarch64
fi

echo ""
echo "Package build complete!"
echo "Generated packages:"
ls -lh "$ARCHIVES_DIR"/*.deb "$ARCHIVES_DIR"/*.rpm 2>/dev/null || echo "No packages found"
