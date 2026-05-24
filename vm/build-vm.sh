#!/usr/bin/env bash
# build-vm.sh - Build a ready-to-run VM image for Dune Awakening self-hosted server
#
# Creates a QCOW2 image (convertible to VHD/VHDX/VMDK) with:
#   - Ubuntu 24.04 LTS base
#   - Docker Engine + Docker Compose v2
#   - Dune server repository pre-cloned
#   - First-boot setup wizard via dune init
#
# Requirements: qemu-img, virt-install (or run inside a CI/build machine)
# Usage: sudo ./build-vm.sh [--format vhd|vhdx|vmdk|qcow2] [--size 100G]

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
VM_NAME="dune-awakening-server"
DISK_SIZE="${2:-100G}"
OUTPUT_FORMAT="${1:---format}"
IMAGE_FORMAT="qcow2"
OUTPUT_DIR="$(pwd)/output"
CLOUD_IMAGE_URL="https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-amd64.img"
CLOUD_IMAGE="ubuntu-24.04-cloudimg.img"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --format) IMAGE_FORMAT="$2"; shift 2 ;;
    --size)   DISK_SIZE="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 [--format qcow2|vhd|vhdx|vmdk] [--size 100G]"
      exit 0
      ;;
    *) shift ;;
  esac
done

mkdir -p "$OUTPUT_DIR"

echo "=== Dune Awakening VM Builder ==="
echo "Disk size:     $DISK_SIZE"
echo "Output format: $IMAGE_FORMAT"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Download Ubuntu cloud image
# ---------------------------------------------------------------------------
if [[ ! -f "$OUTPUT_DIR/$CLOUD_IMAGE" ]]; then
  echo "[1/5] Downloading Ubuntu 24.04 cloud image..."
  curl -L -o "$OUTPUT_DIR/$CLOUD_IMAGE" "$CLOUD_IMAGE_URL"
else
  echo "[1/5] Cloud image already downloaded."
fi

# ---------------------------------------------------------------------------
# Step 2: Create cloud-init configuration
# ---------------------------------------------------------------------------
echo "[2/5] Creating cloud-init configuration..."

cat > "$OUTPUT_DIR/user-data" << 'CLOUDINIT'
#cloud-config
hostname: dune-server
manage_etc_hosts: true
users:
  - name: dune
    groups: [sudo, docker]
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: false
    passwd: $6$rounds=4096$randomsalt$PLACEHOLDER_HASH

package_update: true
package_upgrade: true
packages:
  - docker.io
  - docker-compose-v2
  - git
  - curl
  - htop
  - net-tools
  - ufw

runcmd:
  - systemctl enable docker
  - systemctl start docker
  - git clone https://github.com/Manaiakalani/arrakis-command-nexus.git /opt/dune-server
  - chown -R dune:dune /opt/dune-server
  - |
    cat > /etc/profile.d/dune-welcome.sh << 'MOTD'
    echo ""
    echo "  ╔══════════════════════════════════════════════════════╗"
    echo "  ║     Dune Awakening Self-Hosted Server VM            ║"
    echo "  ║                                                     ║"
    echo "  ║  Get started:                                       ║"
    echo "  ║    cd /opt/dune-server                              ║"
    echo "  ║    ./dune init                                      ║"
    echo "  ║    ./dune start                                     ║"
    echo "  ║                                                     ║"
    echo "  ║  Dashboard: http://<this-ip>:18080                  ║"
    echo "  ║  Docs: /opt/dune-server/docs/                       ║"
    echo "  ╚══════════════════════════════════════════════════════╝"
    echo ""
    MOTD
  - ufw allow 22/tcp
  - ufw allow 18080/tcp
  - ufw allow 7777:7800/udp
  - ufw allow 7888:7900/udp
  - ufw allow 31982/tcp
  - ufw allow 31983/tcp
  - ufw --force enable

write_files:
  - path: /etc/docker/daemon.json
    content: |
      {
        "log-driver": "json-file",
        "log-opts": {
          "max-size": "50m",
          "max-file": "3"
        },
        "storage-driver": "overlay2"
      }

final_message: "Dune Awakening Server VM is ready. Log in as 'dune' and run: cd /opt/dune-server && ./dune init"
CLOUDINIT

cat > "$OUTPUT_DIR/meta-data" << EOF
instance-id: ${VM_NAME}
local-hostname: dune-server
EOF

# ---------------------------------------------------------------------------
# Step 3: Create the seed ISO for cloud-init
# ---------------------------------------------------------------------------
echo "[3/5] Building cloud-init seed ISO..."
if command -v genisoimage &>/dev/null; then
  genisoimage -output "$OUTPUT_DIR/seed.iso" -volid cidata -joliet -rock \
    "$OUTPUT_DIR/user-data" "$OUTPUT_DIR/meta-data" 2>/dev/null
elif command -v mkisofs &>/dev/null; then
  mkisofs -output "$OUTPUT_DIR/seed.iso" -volid cidata -joliet -rock \
    "$OUTPUT_DIR/user-data" "$OUTPUT_DIR/meta-data" 2>/dev/null
else
  echo "WARNING: genisoimage/mkisofs not found. Seed ISO not created."
  echo "         Install with: apt install genisoimage"
fi

# ---------------------------------------------------------------------------
# Step 4: Resize and prepare the disk image
# ---------------------------------------------------------------------------
echo "[4/5] Preparing disk image ($DISK_SIZE)..."
cp "$OUTPUT_DIR/$CLOUD_IMAGE" "$OUTPUT_DIR/${VM_NAME}.qcow2"
qemu-img resize "$OUTPUT_DIR/${VM_NAME}.qcow2" "$DISK_SIZE"

# ---------------------------------------------------------------------------
# Step 5: Convert to requested format
# ---------------------------------------------------------------------------
FINAL_IMAGE="${VM_NAME}.${IMAGE_FORMAT}"

if [[ "$IMAGE_FORMAT" != "qcow2" ]]; then
  echo "[5/5] Converting to $IMAGE_FORMAT..."
  case "$IMAGE_FORMAT" in
    vhd)
      qemu-img convert -f qcow2 -O vpc "$OUTPUT_DIR/${VM_NAME}.qcow2" "$OUTPUT_DIR/${FINAL_IMAGE}"
      ;;
    vhdx)
      qemu-img convert -f qcow2 -O vhdx "$OUTPUT_DIR/${VM_NAME}.qcow2" "$OUTPUT_DIR/${FINAL_IMAGE}"
      ;;
    vmdk)
      qemu-img convert -f qcow2 -O vmdk "$OUTPUT_DIR/${VM_NAME}.qcow2" "$OUTPUT_DIR/${FINAL_IMAGE}"
      ;;
    *)
      echo "Unknown format: $IMAGE_FORMAT. Keeping qcow2."
      FINAL_IMAGE="${VM_NAME}.qcow2"
      ;;
  esac
  rm -f "$OUTPUT_DIR/${VM_NAME}.qcow2"
else
  echo "[5/5] Output format is qcow2 (no conversion needed)."
  FINAL_IMAGE="${VM_NAME}.qcow2"
fi

echo ""
echo "=== Build complete ==="
echo "Image: $OUTPUT_DIR/$FINAL_IMAGE"
echo ""
echo "To import into Hyper-V (VHD/VHDX):"
echo "  New-VM -Name 'DuneServer' -MemoryStartupBytes 32GB -VHDPath '.\\output\\${FINAL_IMAGE}'"
echo ""
echo "To import into VirtualBox (VMDK):"
echo "  VBoxManage createvm --name DuneServer --register"
echo "  VBoxManage storagectl DuneServer --name SATA --add sata"
echo "  VBoxManage storageattach DuneServer --storagectl SATA --port 0 --type hdd --medium ./output/${FINAL_IMAGE}"
echo ""
echo "To run with QEMU (QCOW2):"
echo "  qemu-system-x86_64 -m 32G -smp 8 -enable-kvm -drive file=./output/${FINAL_IMAGE} -cdrom ./output/seed.iso -net nic -net user,hostfwd=tcp::18080-:18080"
