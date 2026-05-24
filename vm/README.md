# Virtual Machine Deployment

Run the Dune Awakening self-hosted server as a standalone VM instead of (or alongside) Docker on your existing host.

## Why a VM?

- **Isolation**: Dedicated resources without sharing the host Docker daemon
- **Portability**: Move the entire server between machines by copying one file
- **Hyper-V/VirtualBox/Proxmox**: Run on hypervisors without installing Docker on the host
- **Snapshots**: Use hypervisor-level snapshots for instant rollback

## Quick Start

### Option 1: Build from script (Linux)

```bash
cd vm/
sudo ./build-vm.sh --format vhdx --size 100G
```

Supported output formats:

| Format | Hypervisor |
| --- | --- |
| `qcow2` | QEMU, Proxmox |
| `vhd` | Hyper-V (Generation 1) |
| `vhdx` | Hyper-V (Generation 2) |
| `vmdk` | VirtualBox, VMware |

### Option 2: Manual setup

1. Create a VM with Ubuntu 24.04 LTS (or any Docker-compatible Linux)
2. Allocate at least 20 GB RAM, 4 CPU cores, 100 GB storage
3. Install Docker and Docker Compose v2:

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo systemctl enable docker
sudo usermod -aG docker $USER
```

4. Clone and run:

```bash
git clone https://github.com/manailab/dune-server-docker.git /opt/dune-server
cd /opt/dune-server
./dune init
./dune start
```

## VM Sizing Guide

| Profile | RAM | CPU | Disk |
| --- | --- | --- | --- |
| Basic (Survival + Overmap) | 20 GB | 4 cores | 80 GB |
| Standard (+ Deep Desert, social, story) | 32 GB | 6 cores | 100 GB |
| Full (all maps) | 48+ GB | 8+ cores | 150 GB |

## Hyper-V Import

```powershell
# Import the VHDX
New-VM -Name "DuneServer" -MemoryStartupBytes 32GB -Generation 2 `
  -VHDPath ".\output\dune-awakening-server.vhdx"
Set-VM -Name "DuneServer" -ProcessorCount 8
Start-VM -Name "DuneServer"
```

## VirtualBox Import

```bash
VBoxManage createvm --name "DuneServer" --ostype Ubuntu_64 --register
VBoxManage modifyvm "DuneServer" --memory 32768 --cpus 8
VBoxManage storagectl "DuneServer" --name "SATA" --add sata
VBoxManage storageattach "DuneServer" --storagectl "SATA" \
  --port 0 --type hdd --medium ./output/dune-awakening-server.vmdk
VBoxManage startvm "DuneServer"
```

## Proxmox Import

```bash
# Upload the qcow2 image, then import
qm create 100 --name "DuneServer" --memory 32768 --cores 8 --net0 virtio,bridge=vmbr0
qm importdisk 100 dune-awakening-server.qcow2 local-lvm
qm set 100 --scsi0 local-lvm:vm-100-disk-0
qm start 100
```

## Networking

The VM needs the same ports open as the Docker deployment:

| Port | Protocol | Purpose |
| --- | --- | --- |
| 22 | TCP | SSH management |
| 18080 | TCP | Dashboard (Arrakis Command Nexus) |
| 7777-7800 | UDP | Game traffic |
| 7888-7900 | UDP | Server-to-server |
| 31982 | TCP | RabbitMQ game traffic |
| 31983 | TCP | RabbitMQ HTTP |

The build script configures UFW with these rules automatically.

## Backups

VM-level snapshots complement the built-in `./dune backup` command:

```bash
# In-app backup (database + config + saves)
./dune backup

# Hypervisor snapshot (entire VM state)
# Hyper-V: Checkpoint-VM -Name "DuneServer"
# Proxmox: qm snapshot 100 pre-update
# VirtualBox: VBoxManage snapshot "DuneServer" take "pre-update"
```
